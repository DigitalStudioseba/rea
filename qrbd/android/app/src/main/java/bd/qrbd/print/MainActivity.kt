package bd.qrbd.print

import android.app.Activity
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.*
import android.text.InputType
import android.view.ViewGroup
import android.widget.*
import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/** Native Android Print Framework companion. No silent/raw USB printing. */
class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())
    private lateinit var origin: EditText
    private lateinit var token: EditText
    private lateinit var status: TextView
    private lateinit var next: Button
    private var base = ""
    private var bearer = ""
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40,50,40,30) }
        layout.addView(TextView(this).apply { text = "QRBD Print"; textSize = 30f })
        layout.addView(TextView(this).apply { text = "Android print service প্রয়োজন। Silent OTG নয়। Copies ও printer system dialog-এ মিলিয়ে নিন। Device token শুধু memory-তে থাকবে।" })
        origin = EditText(this).apply { hint = "https://your-qrbd-domain"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI }
        token = EditText(this).apply { hint = "Owner dashboard-এর device token"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        next = Button(this).apply { text = "পরের paid কাজ নিন"; setOnClickListener { claim() } }
        status = TextView(this).apply { text = "প্রথমে URL ও device token দিন।"; setTextIsSelectable(true) }
        layout.addView(origin); layout.addView(token); layout.addView(next); layout.addView(status)
        setContentView(ScrollView(this).apply { addView(layout, ViewGroup.LayoutParams(-1,-2)) })
    }
    private fun request(endpoint: String, payload: JSONObject? = null, binary: Boolean = false): ByteArray {
        val connection = URI(base + endpoint).toURL().openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 20000; connection.readTimeout = 30000; connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer $bearer")
            connection.setRequestProperty("x-qrbd-request", "1")
            if (payload != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            require(connection.responseCode in 200..299) { "Server request rejected (${connection.responseCode})" }
            val limit = if (binary) 32*1024*1024 else 256000
            val out = java.io.ByteArrayOutputStream()
            connection.inputStream.use { input -> val buffer = ByteArray(8192); while (true) { val n = input.read(buffer); if (n < 0) break; require(out.size()+n <= limit) { "Response too large" }; out.write(buffer,0,n) } }
            return out.toByteArray()
        } finally { connection.disconnect() }
    }
    private fun claim() {
        if (busy) return
        try {
            val uri = URI(origin.text.toString().trim())
            require(uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.path in listOf("", "/") && uri.query == null && uri.fragment == null)
            base = uri.toString().trimEnd('/'); bearer = token.text.toString().trim()
            require(bearer.matches(Regex("[a-f0-9]{64}")))
        } catch (_: Exception) { status.text = "সঠিক HTTPS origin ও token দিন।"; return }
        busy = true; next.isEnabled = false; origin.isEnabled = false; token.isEnabled = false; status.text = "কাজ খোঁজা হচ্ছে…"
        worker.execute {
            var claimed: String? = null
            try {
                val packet = JSONObject(String(request("/api/agent/claim", JSONObject().put("platform","android")), Charsets.UTF_8))
                if (packet.isNull("job")) { ui.post { finishJob(if (packet.has("attention")) "আগের কাজ dashboard-এ reconcile করুন।" else if (packet.has("error")) packet.getString("error") else "নতুন paid কাজ নেই।") }; return@execute }
                val job = packet.getJSONObject("job"); val id = job.getString("id")
                require(id.matches(Regex("[a-f0-9]{24}"))); claimed = id
                val pdf = request("/api/agent/jobs/$id/document", binary = true)
                require(pdf.size == job.getInt("bytes") && String(pdf.take(5).toByteArray(),Charsets.US_ASCII) == "%PDF-")
                val hash = MessageDigest.getInstance("SHA-256").digest(pdf).joinToString("") { "%02x".format(it.toInt() and 0xff) }
                require(hash == job.getString("sha256"))
                ui.post { printPdf(job, pdf) }
            } catch (_: Exception) {
                claimed?.let { try { request("/api/agent/jobs/$it/report",JSONObject().put("status","attention")) } catch (_: Exception) {} }
                ui.post { finishJob("প্রক্রিয়াকরণ হয়নি। Claim হয়ে থাকলে dashboard-এ পরীক্ষা করুন; blind retry নয়।") }
            }
        }
    }
    private fun printPdf(job: JSONObject, bytes: ByteArray) {
        try {
            status.text = "${job.getInt("pages")} পাতা · ${job.getInt("copies")} copies · ${if(job.getBoolean("color")) "Color" else "B&W"}\nSystem dialog-এ copies ও printer নির্বাচন করুন।"
            val adapter = object: PrintDocumentAdapter() {
                override fun onLayout(oldAttributes: PrintAttributes?, newAttributes: PrintAttributes?, cancellationSignal: CancellationSignal, callback: LayoutResultCallback, extras: Bundle?) {
                    if(cancellationSignal.isCanceled) callback.onLayoutCancelled()
                    else callback.onLayoutFinished(PrintDocumentInfo.Builder("QRBD-document.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(job.getInt("pages")).build(),true)
                }
                override fun onWrite(pages: Array<out PageRange>, destination: ParcelFileDescriptor, cancellationSignal: CancellationSignal, callback: WriteResultCallback) {
                    // Never silently print unrequested page ranges. This adapter supplies full PDFs only.
                    if (cancellationSignal.isCanceled) { callback.onWriteCancelled(); return }
                    if (!pages.any { it.start == 0 && it.end >= job.getInt("pages")-1 }) { callback.onWriteFailed("Full document only; select all pages."); return }
                    try { ParcelFileDescriptor.AutoCloseOutputStream(destination).use { out ->
                        var offset = 0
                        while(offset < bytes.size) { if(cancellationSignal.isCanceled) { callback.onWriteCancelled(); return }; val n = minOf(8192,bytes.size-offset); out.write(bytes,offset,n); offset += n }
                    }; callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES)) } catch (_: Exception) { callback.onWriteFailed("PDF write failed") }
                }
            }
            val attrs = PrintAttributes.Builder().setColorMode(if(job.getBoolean("color")) PrintAttributes.COLOR_MODE_COLOR else PrintAttributes.COLOR_MODE_MONOCHROME)
                .setDuplexMode(when(job.getString("duplex")){"long" -> PrintAttributes.DUPLEX_MODE_LONG_EDGE; "short" -> PrintAttributes.DUPLEX_MODE_SHORT_EDGE; else -> PrintAttributes.DUPLEX_MODE_NONE })
                .setMediaSize(if(job.getString("kind")=="photo") PrintAttributes.MediaSize.NA_INDEX_4X6 else PrintAttributes.MediaSize.ISO_A4).build()
            val printed = (getSystemService(PRINT_SERVICE) as PrintManager).print("QRBD-${job.getString("id").takeLast(8)}",adapter,attrs)
            watch(printed,job.getString("id"),System.currentTimeMillis())
        } catch (_: Exception) { report(job.getString("id"),"attention") }
    }
    private fun watch(job: PrintJob, id: String, since: Long) {
        when { job.isCompleted -> report(id,"submitted")
            job.isCancelled || job.isFailed || System.currentTimeMillis()-since > 12*60*1000 -> report(id,"attention")
            else -> ui.postDelayed({ watch(job,id,since) },2000) }
    }
    private fun report(id: String, result: String) { worker.execute {
        var success = false
        for (attempt in 0..2) { try { request("/api/agent/jobs/$id/report",JSONObject().put("status",result)); success = true; break } catch (_: Exception) { Thread.sleep(1000) } }
        ui.post { finishJob(if(success) "Status: $result. কাগজ দেখে দোকানের dashboard-এ completion নিশ্চিত করুন।" else "Report নিশ্চিত হয়নি। Dashboard-এ reconcile করুন।") }
    } }
    private fun finishJob(message: String) { busy = false; next.isEnabled = true; origin.isEnabled = true; token.isEnabled = true; status.text = message }
    override fun onDestroy() { ui.removeCallbacksAndMessages(null); worker.shutdown(); super.onDestroy() }
}
