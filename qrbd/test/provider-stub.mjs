// Explicit test-only transport. Never imported by the production entrypoint.
if (process.env.NODE_ENV !== "test")
  throw Error("Refusing to load simulated gateway outside tests");
const original = globalThis.fetch,
  transactions = new Map();
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (!["secure.aamarpay.com", "sandbox.aamarpay.com"].includes(u.hostname))
    return original(url, init);
  if (u.pathname === "/jsonpost.php") {
    const b = JSON.parse(init.body);
    transactions.set(b.tran_id, {
      amount: b.amount,
      store_id: b.store_id,
      mer_txnid: b.tran_id,
      pay_status: "Successful",
      status_code: "2",
      currency: "BDT",
      bad: b.cus_name === "Mismatch",
    });
    return new Response(
      JSON.stringify({
        result: "true",
        payment_url: u.origin + "/checkout/" + b.tran_id,
      }),
    );
  }
  const r = transactions.get(u.searchParams.get("request_id"));
  return new Response(
    JSON.stringify(r ? { ...r, amount: r.bad ? "0.01" : r.amount } : {}),
  );
};
