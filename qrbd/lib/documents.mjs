import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
export function printOptions(body = {}) {
  const copies = Number(body.copies ?? 1),
    color = body.color === "color",
    duplex = body.duplex || "off";
  if (
    !Number.isInteger(copies) ||
    copies < 1 ||
    copies > 20 ||
    !["bw", "color"].includes(body.color || "bw") ||
    !["off", "long", "short"].includes(duplex)
  )
    throw bad("Copies ১–২০ ও সঠিক color/duplex mode দিন।");
  return { copies, color, duplex };
}
async function image(pdf, b) {
  let img;
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    img = await pdf.embedPng(b);
  else if (b[0] === 255 && b[1] === 216 && b[2] === 255)
    img = await pdf.embedJpg(b);
  else throw bad("শুধু PDF, JPG ও PNG গ্রহণ করা হয়।");
  if (img.width * img.height > 25e6)
    throw bad("ছবি সর্বোচ্চ ২৫ megapixel হতে পারে।");
  return img;
}
export async function mergeDocuments(files) {
  if (
    !files?.length ||
    files.length > 5 ||
    files.some((f) => f.buffer.length > 10 * 1024 * 1024) ||
    files.reduce((n, f) => n + f.buffer.length, 0) > 25 * 1024 * 1024
  )
    throw bad("১–৫টি ফাইল, প্রতি ফাইল ১০ MB ও মোট ২৫ MB দিন।");
  const pdf = await PDFDocument.create();
  try {
    for (const { buffer: b } of files) {
      if (b.subarray(0, 5).toString() === "%PDF-") {
        const src = await PDFDocument.load(b);
        if (src.getPageCount() < 1 || src.getPageCount() > 200)
          throw bad("PDF-এ ১–২০০ পাতা থাকতে হবে।");
        for (const page of await pdf.copyPages(src, src.getPageIndices()))
          pdf.addPage(page);
      } else {
        const img = await image(pdf, b),
          p = pdf.addPage([595.28, 841.89]),
          scale = Math.min(555.28 / img.width, 801.89 / img.height);
        p.drawImage(img, {
          x: (p.getWidth() - img.width * scale) / 2,
          y: (p.getHeight() - img.height * scale) / 2,
          width: img.width * scale,
          height: img.height * scale,
        });
      }
      if (pdf.getPageCount() > 200) throw bad("এক অর্ডারে সর্বোচ্চ ২০০ পাতা।");
    }
  } catch (e) {
    if (e.status) throw e;
    throw bad("ফাইল পড়া যায়নি। নষ্ট বা password-protected PDF বাদ দিন।");
  }
  return { bytes: Buffer.from(await pdf.save()), pages: pdf.getPageCount() };
}
export async function photoSheet(buffer, { count = 6, size = "4x6" } = {}) {
  count = Number(count);
  if (![4, 6, 8, 10, 12].includes(count) || !["4x6", "a4"].includes(size))
    throw bad("Photo layout সঠিক নয়।");
  if (buffer.length > 10 * 1024 * 1024) throw bad("ছবি সর্বোচ্চ ১০ MB।");
  const pdf = await PDFDocument.create();
  let img;
  try {
    img = await image(pdf, buffer);
  } catch (e) {
    throw e.status ? e : bad("ছবিটি পড়া যায়নি।");
  }
  const page = pdf.addPage(size === "a4" ? [595.28, 841.89] : [288, 432]);
  const columns = count === 4 ? 2 : count === 6 ? 2 : 3,
    rows = Math.ceil(count / columns),
    margin = 12,
    gap = 6;
  const cw = (page.getWidth() - 2 * margin - gap * (columns - 1)) / columns,
    ch = (page.getHeight() - 2 * margin - gap * (rows - 1)) / rows;
  // Fit, never stretch. This is a general photo sheet, not certified passport dimensions.
  for (let i = 0; i < count; i++) {
    const col = i % columns,
      row = Math.floor(i / columns),
      scale = Math.min(cw / img.width, ch / img.height),
      x = margin + col * (cw + gap),
      y = page.getHeight() - margin - (row + 1) * ch - row * gap;
    page.drawRectangle({
      x,
      y,
      width: cw,
      height: ch,
      borderColor: rgb(0.65, 0.65, 0.65),
      borderWidth: 0.35,
    });
    page.drawImage(img, {
      x: x + (cw - img.width * scale) / 2,
      y: y + (ch - img.height * scale) / 2,
      width: img.width * scale,
      height: img.height * scale,
    });
  }
  return { bytes: Buffer.from(await pdf.save()), pages: 1 };
}
export async function resumePDF(input) {
  const template = input.template || "classic";
  if (!["classic", "modern", "compact"].includes(template))
    throw bad("Resume template সঠিক নয়।");
  const fields = [
    "name",
    "title",
    "email",
    "phone",
    "summary",
    "experience",
    "education",
    "skills",
  ];
  const limits = {
    name: 80,
    title: 100,
    email: 120,
    phone: 40,
    summary: 900,
    experience: 2000,
    education: 1000,
    skills: 600,
  };
  const values = {};
  for (const key of fields) {
    values[key] = String(input[key] || "").trim();
    if (
      values[key].length > limits[key] ||
      /[^\x20-\x7E\n\r]/.test(values[key])
    )
      throw bad(
        "Resume-তে আপাতত English text দিন; field length কমান। বাংলা resume PDF এখন সমর্থিত নয়।",
      );
  }
  if (!values.name) throw bad("Resume-তে নাম প্রয়োজন।");
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent =
      template === "modern" ? rgb(0.08, 0.32, 0.25) : rgb(0.12, 0.16, 0.17),
    margin = 48,
    width = 499,
    size = template === "compact" ? 10 : 11,
    line = size + 5;
  let page, y;
  function newPage() {
    page = pdf.addPage([595.28, 841.89]);
    y = 790;
  }
  function text(value, { heading = false, large = false } = {}) {
    const f = heading ? bold : font,
      fs = large ? 24 : heading ? 12 : size;
    for (const para of value.split(/\r?\n/)) {
      let current = "";
      for (const word of para.split(/\s+/)) {
        if (f.widthOfTextAtSize(word, fs) > width)
          throw bad("Resume-এ অতিরিক্ত দীর্ঘ শব্দ বা URL ছোট করুন।");
        const next = current ? current + " " + word : word;
        if (f.widthOfTextAtSize(next, fs) > width) {
          if (y < 55) newPage();
          page.drawText(current, {
            x: margin,
            y,
            size: fs,
            font: f,
            color: heading ? accent : rgb(0.2, 0.24, 0.23),
          });
          y -= line;
          current = word;
        } else current = next;
      }
      if (y < 55) newPage();
      page.drawText(current, {
        x: margin,
        y,
        size: fs,
        font: f,
        color: heading ? accent : rgb(0.2, 0.24, 0.23),
      });
      y -= large ? 34 : line;
    }
  }
  newPage();
  text(values.name, { heading: true, large: true });
  text(values.title);
  text([values.email, values.phone].filter(Boolean).join(" | "));
  y -= 16;
  for (const [key, label] of [
    ["summary", "PROFILE"],
    ["experience", "EXPERIENCE"],
    ["education", "EDUCATION"],
    ["skills", "SKILLS"],
  ])
    if (values[key]) {
      if (y < 100) newPage();
      text(label, { heading: true });
      y -= 5;
      text(values[key]);
      y -= 16;
    }
  return { bytes: Buffer.from(await pdf.save()), pages: pdf.getPageCount() };
}
export function routeFor(job) {
  if (job.kind === "photo") return "photo";
  if (job.duplex !== "off") return "duplex";
  return job.color ? "color" : "bw";
}
