import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";

const files = [
  "templates/contracts/sales_brokerage_agreement.docx",
  "templates/contracts/payment_receipt.docx",
];

function convertXml(xml) {
  const openMap = {
    "[IF BRAND NEW]": "is_brand_new",
    "[IF USED]": "is_used",
    "[IF FULL PAYMENT]": "is_full_payment",
    "[IF DEPOSIT]": "is_deposit",
  };
  const tokenRe = /\[IF BRAND NEW\]|\[IF USED\]|\[IF FULL PAYMENT\]|\[IF DEPOSIT\]|\[END IF\]/g;
  let out = "";
  let last = 0;
  const stack = [];
  let m = tokenRe.exec(xml);
  while (m) {
    out += xml.slice(last, m.index);
    const token = m[0];
    if (token === "[END IF]") {
      const name = stack.pop() || "is_full_payment";
      out += `{{/${name}}}`;
    } else {
      const name = openMap[token];
      stack.push(name);
      out += `{{#${name}}}`;
    }
    last = m.index + token.length;
    m = tokenRe.exec(xml);
  }
  out += xml.slice(last);
  return out;
}

for (const rel of files) {
  const abs = path.resolve(rel);
  const content = fs.readFileSync(abs);
  const zip = new PizZip(content);
  const xmlPath = "word/document.xml";
  const xml = zip.file(xmlPath)?.asText();
  if (!xml) throw new Error(`Missing ${xmlPath} in ${rel}`);
  zip.file(xmlPath, convertXml(xml));
  const buf = zip.generate({ type: "nodebuffer" });
  fs.writeFileSync(abs, buf);
  console.log(`Converted conditionals in ${rel}`);
}
