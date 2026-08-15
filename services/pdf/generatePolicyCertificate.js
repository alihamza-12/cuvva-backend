const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const ASSET_DIR = path.join(__dirname, "..", "..", "public", "pdf-assets");
const ADMIN_FEE = 10.71;
const IPT_RATE = 0.12;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 35;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const FONT_REGULAR = "OpenSans";
const FONT_BOLD = "OpenSansBold";
const FONT_ITALIC = "OpenSansItalic";
const TEXT = "#36363b";
const MUTED = "#9897ad";
const LIGHT = "#e3e3e5";

const ordinal = (day) => {
  const remainder100 = day % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${day}th`;
  return `${day}${{ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th"}`;
};

const datePart = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return {
    iso: date.toISOString().slice(0, 10),
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
};

const getLondonTimeZoneName = (dateValue, timeValue) => {
  const part = datePart(dateValue);
  if (!part) return "GMT";
  const time = /^\d{1,2}:\d{2}$/.test(String(timeValue || ""))
    ? String(timeValue)
    : "12:00";
  const instant = new Date(`${part.iso}T${time}:00.000Z`);
  const zonePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "short",
  })
    .formatToParts(instant)
    .find((item) => item.type === "timeZoneName");
  return zonePart?.value === "GMT+1" ? "BST" : zonePart?.value || "GMT";
};

const formatPolicyDateTime = (dateValue, timeValue, endOfMinute = false) => {
  const part = datePart(dateValue);
  if (!part) return "N/A";
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(part.year, part.monthIndex, part.day)));
  const normalizedTime = /^\d{1,2}:\d{2}$/.test(String(timeValue || ""))
    ? String(timeValue).padStart(5, "0")
    : "00:00";
  return `${normalizedTime}:${endOfMinute ? "59" : "00"} ${getLondonTimeZoneName(
    dateValue,
    normalizedTime,
  )} on ${ordinal(part.day)} ${month} ${part.year}`;
};

const formatBirthDate = (dateValue) => {
  const part = datePart(dateValue);
  if (!part) return "N/A";
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(part.year, part.monthIndex, part.day)));
  return `${ordinal(part.day)} ${month} ${part.year}`;
};

const formatAddress = (address) => {
  if (!address) return "N/A";
  const values = [
    address.line1,
    address.line2,
    address.city,
    address.county,
    address.postcode,
    address.country,
  ].filter(Boolean);
  return values.length ? values.join(", ") : "N/A";
};

const calculatePaymentBreakdown = (totalValue) => {
  const total = Math.max(0, Number(totalValue) || 0);
  const adminFee = Math.min(ADMIN_FEE, total);
  const remainder = total - adminFee;
  const insurancePremium = Math.round((remainder / (1 + IPT_RATE)) * 100) / 100;
  const insurancePremiumTax = Math.round((remainder - insurancePremium) * 100) / 100;
  return {
    totalPrice: total.toFixed(2),
    adminFee: adminFee.toFixed(2),
    insurancePremium: insurancePremium.toFixed(2),
    insurancePremiumTax: insurancePremiumTax.toFixed(2),
  };
};

const buildDocumentData = ({ policy, customer, vehicle }) => ({
  policyNumber: policy.policyNumber || String(policy._id),
  validFrom: formatPolicyDateTime(policy.startDate, policy.startTime),
  validUntil: formatPolicyDateTime(policy.endDate, policy.endTime, true),
  customerName: customer.fullName || "N/A",
  birthDate: formatBirthDate(customer.dateOfBirth),
  drivingLicenceNumber: customer.drivingLicenceNumber || "N/A",
  address: formatAddress(customer.address),
  phone: customer.phone || "N/A",
  registration: vehicle.registration || "N/A",
  vin: vehicle.vehicleIdentificationNumber || "N/A",
  vehicleMake: vehicle.make || "N/A",
  vehicleModel: vehicle.model || "N/A",
  vehicleColour: vehicle.colour || "N/A",
  vehicleYear: vehicle.year || "N/A",
  coverageType: policy.coverageType || "N/A",
  excess: Number(policy.excess ?? 500).toFixed(0),
  ...calculatePaymentBreakdown(policy.premiumAmount),
});

const setupDocument = () => {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: "Policy details and certificate",
      Author: "Cuvva",
      Subject: "Motor insurance policy schedule and certificate",
    },
  });
  doc.registerFont(FONT_REGULAR, path.join(ASSET_DIR, "OpenSans-Regular.woff"));
  doc.registerFont(FONT_BOLD, path.join(ASSET_DIR, "OpenSans-Bold.woff"));
  doc.registerFont(FONT_ITALIC, path.join(ASSET_DIR, "OpenSans-Italic.woff"));
  return doc;
};

const addPage = (doc) => {
  doc.addPage({ size: "A4", margin: 0 });
  doc
    .moveTo(MARGIN_X, 24)
    .lineTo(PAGE_WIDTH - MARGIN_X, 24)
    .lineWidth(0.6)
    .strokeColor("#d4d4d6")
    .stroke();
};

const heading = (doc, text, x, y, size = 29) => {
  doc.font(FONT_REGULAR).fontSize(size).fillColor(MUTED).text(text, x, y, {
    lineGap: 0,
  });
};

const labelValue = (doc, label, text, x, y, options = {}) => {
  const labelWidth = options.labelWidth || 82;
  const width = options.width || 225;
  doc.font(FONT_BOLD).fontSize(options.size || 9.6).fillColor(TEXT).text(label, x, y, {
    width: labelWidth,
    lineBreak: false,
  });
  doc.font(FONT_REGULAR).fillColor(TEXT).text(String(text || "N/A"), x + labelWidth, y, {
    width: width - labelWidth,
    lineGap: 1.5,
  });
};

const codeValue = (doc, text, x, y, fontSize = 8.6) => {
  const display = String(text || "N/A");
  const padding = 3;
  doc.font(FONT_REGULAR).fontSize(fontSize);
  const width = doc.widthOfString(display) + padding * 2;
  doc.rect(x, y - 1, width, fontSize + 7).fillAndStroke("#f4f4f6", "#dddde2");
  doc.fillColor(TEXT).text(display, x + padding, y + 1, { lineBreak: false });
  return width;
};

const pageOne = (doc, data) => {
  addPage(doc);
  const leftX = MARGIN_X;
  const rightX = 298;

  doc.image(path.join(__dirname, "..", "..", "public", "email-assets", "cuvva-logo.png"), 241, 20, {
    width: 113,
    height: 25,
  });
  heading(doc, "Policy details", leftX, 66, 28);
  doc.rect(leftX, 102, 4, 43).fill("#e1e1e3");
  doc
    .font(FONT_REGULAR)
    .fontSize(9.8)
    .fillColor(TEXT)
    .text(
      "This is your policy schedule and statement of fact. Your certificate can be found further down.",
      leftX + 12,
      103,
      { width: 225, lineGap: 2 },
    );

  doc.rect(rightX, 70, 263, 81).fill("#e5e5e6");
  doc.fontSize(8.7);
  doc.font(FONT_BOLD).fillColor(TEXT).text("Ref code", rightX + 16, 84);
  codeValue(doc, data.policyNumber, rightX + 76, 81, 7.5);
  doc.font(FONT_BOLD).text("Valid from", rightX + 16, 108);
  doc.font(FONT_REGULAR).text(data.validFrom, rightX + 76, 108, { width: 164 });
  doc.font(FONT_BOLD).text("Valid until", rightX + 16, 131);
  doc.font(FONT_REGULAR).text(data.validUntil, rightX + 76, 131, { width: 164 });

  heading(doc, "Policyholder", leftX, 174, 20);
  labelValue(doc, "Name", data.customerName, leftX, 208, { labelWidth: 55, width: 230, size: 8.5 });
  labelValue(doc, "Birth date", data.birthDate, leftX, 229, { labelWidth: 72, width: 230, size: 8.5 });
  doc.font(FONT_BOLD).fontSize(8.5).text("Driving licence number", leftX, 250);
  codeValue(doc, data.drivingLicenceNumber, leftX + 123, 247, 7.3);
  doc.font(FONT_BOLD).fontSize(8.5).text("Residential address", leftX, 275);
  doc.font(FONT_REGULAR).fontSize(8.5).text(data.address, leftX, 294, { width: 232, lineGap: 1 });
  labelValue(doc, "Mobile", data.phone, leftX, 319, { labelWidth: 63, width: 230, size: 8.5 });

  heading(doc, "Vehicle", rightX, 174, 20);
  doc.font(FONT_BOLD).fontSize(8.5).text("Registration mark", rightX, 208);
  codeValue(doc, data.registration, rightX + 113, 205, 7.3);
  doc.font(FONT_BOLD).fontSize(8.5).text("VIN", rightX, 229);
  codeValue(doc, data.vin, rightX + 42, 226, 7.3);
  labelValue(doc, "Make", data.vehicleMake, rightX, 254, { labelWidth: 52, width: 230, size: 8.5 });
  labelValue(doc, "Model", data.vehicleModel, rightX, 275, { labelWidth: 57, width: 230, size: 8.5 });
  labelValue(doc, "Colour", data.vehicleColour, rightX, 296, { labelWidth: 57, width: 230, size: 8.5 });
  labelValue(doc, "Year manufactured", data.vehicleYear, rightX, 317, { labelWidth: 113, width: 230, size: 8.5 });

  doc.font(FONT_REGULAR).fontSize(12.2).fillColor(TEXT).text("Incident history", leftX, 349);
  doc.fontSize(8.5).text("Incidents in the last three years are included.", leftX, 377);
  doc.font(FONT_BOLD).fontSize(8.2);
  doc.text("Date", leftX + 4, 398);
  doc.text("Category", leftX + 86, 398);
  doc.text("Value", leftX + 174, 398);
  doc.moveTo(leftX, 412).lineTo(leftX + 232, 412).lineWidth(0.8).strokeColor(TEXT).stroke();
  doc.font(FONT_ITALIC).fontSize(8).text("No incidents declared.", leftX + 4, 416);
  doc.moveTo(leftX, 430).lineTo(leftX + 232, 430).lineWidth(0.5).strokeColor("#777777").stroke();

  heading(doc, "Policy", leftX, 453, 20);
  labelValue(doc, "Cover level", data.coverageType, leftX, 493, { labelWidth: 82, width: 230, size: 8.5 });

  heading(doc, "Excess", rightX, 453, 20);
  doc.font(FONT_REGULAR).fontSize(8.5).fillColor(TEXT).text("Your excesses are as follows:", rightX, 493);
  doc.font(FONT_BOLD).fontSize(8.3).text("Accidental damage, fire and theft", rightX, 532, { continued: true });
  doc.font(FONT_REGULAR).text(`  Total - £${data.excess}`);
};

const pageTwo = (doc, data, qrBuffer) => {
  addPage(doc);
  heading(doc, "Declarations", MARGIN_X, 28, 20);
  doc.font(FONT_REGULAR).fontSize(8.7).fillColor(TEXT).text("You have confirmed the following information:", MARGIN_X, 62);

  const declarations = [
    "I am not currently banned from driving, nor have I received a driving ban outside of the UK during the last 5 years",
    "The vehicle has no modifications other than those on the approved list",
    "The vehicle has a valid MOT and Tax where required by law",
    "I have declared any relevant medical conditions to the DVLA or Licensing Authority and have been cleared to drive",
    "The driving licence I used to purchase this policy is valid and in date",
    "I understand I can only use the vehicle for social or domestic activities, leisure or commuting, or in connection with my business but only if driven by me",
    "I have never had a policy cancelled, refused or voided by an insurer",
    "I have no unspent criminal convictions or prosecutions pending (excluding motoring offences)",
    "The vehicle will be in the UK when the policy starts and ends and I will not permanently export the vehicle",
    "The vehicle is not currently impounded",
    "I will not use the vehicle for any motor trade related activities",
    "I am aware how much my vehicle is worth and understand this impacts my settlement in the event of a claim",
  ];

  let y = 85;
  doc.fontSize(7.5);
  for (const declaration of declarations) {
    doc.font(FONT_BOLD).fillColor(MUTED).text("✓", MARGIN_X, y, { width: 12 });
    doc.font(FONT_REGULAR).fillColor(TEXT).text(declaration, MARGIN_X + 16, y, {
      width: CONTENT_WIDTH - 16,
      lineGap: 1,
    });
    y += Math.max(18, doc.heightOfString(declaration, { width: CONTENT_WIDTH - 16, lineGap: 1 }) + 5);
  }

  y += 4;
  doc.moveTo(MARGIN_X, y).lineTo(PAGE_WIDTH - MARGIN_X, y).lineWidth(0.5).strokeColor("#dadadc").stroke();
  heading(doc, "Payment", MARGIN_X, y + 15, 14.5);
  doc.font(FONT_REGULAR).fontSize(10.4).fillColor(TEXT).text("You paid ", MARGIN_X, y + 47, { continued: true });
  doc.font(FONT_BOLD).text(`£${data.totalPrice}`, { continued: true });
  doc.font(FONT_REGULAR).text(". This includes ", { continued: true });
  doc.font(FONT_BOLD).text(`£${data.insurancePremium}`, { continued: true });
  doc.font(FONT_REGULAR).text(" insurance premium, a ", { continued: true });
  doc.font(FONT_BOLD).text(`£${data.adminFee}`, { continued: true });
  doc.font(FONT_REGULAR).text(" admin fee, and ", { continued: true });
  doc.font(FONT_BOLD).text(`£${data.insurancePremiumTax}`, { continued: true });
  doc.font(FONT_REGULAR).text(" insurance premium tax.", { width: CONTENT_WIDTH });

  const contactY = y + 102;
  doc.moveTo(MARGIN_X, contactY).lineTo(PAGE_WIDTH - MARGIN_X, contactY).lineWidth(0.5).strokeColor("#dadadc").stroke();
  heading(doc, "Contact", MARGIN_X, contactY + 15, 14.5);
  doc.font(FONT_REGULAR).fontSize(9.7).fillColor(TEXT).text(
    "In the event of an incident, please contact us as soon as reasonably possible by ",
    MARGIN_X,
    contactY + 47,
    { width: CONTENT_WIDTH, continued: true, lineGap: 3 },
  );
  doc.font(FONT_BOLD).text("messaging us in the app.", { continued: true });
  doc.font(FONT_REGULAR).text(" Or, call our claims helpline on ", { continued: true });
  doc.fillColor(MUTED).text("020 3828 7381.");
  doc.fillColor(TEXT).text(
    "For anything else, get in touch with Cuvva in-app, or email ",
    MARGIN_X,
    contactY + 96,
    { continued: true, width: CONTENT_WIDTH },
  );
  doc.fillColor(MUTED).text("support@cuvva.com", { continued: true });
  doc.fillColor(TEXT).text(" and we'll get back to you as soon as we can.");

  doc.image(qrBuffer, MARGIN_X, contactY + 139, { width: 58, height: 58 });
  doc.font(FONT_REGULAR).fontSize(7.1).fillColor(TEXT).text(
    "Need to prove you're insured? Just scan this unique QR code for an instant view of your policy status.",
    MARGIN_X + 70,
    contactY + 157,
    { width: CONTENT_WIDTH - 70 },
  );
};

const pageThree = (doc, data) => {
  addPage(doc);
  heading(doc, "Certificate of motor insurance", MARGIN_X, 28, 20);
  doc.rect(MARGIN_X, 62, 4, 35).fill("#e1e1e3");
  doc.font(FONT_REGULAR).fontSize(8.7).fillColor(TEXT).text(
    "This part is your legal proof of insurance. You may be required to present it to a police officer or court of law.",
    MARGIN_X + 10,
    64,
    { width: CONTENT_WIDTH - 10, lineGap: 2 },
  );
  doc.font(FONT_REGULAR).fontSize(4.8).text("Form A", PAGE_WIDTH - MARGIN_X - 28, 81, { width: 28, align: "right" });

  const boxX = MARGIN_X;
  const boxY = 87;
  const boxW = CONTENT_WIDTH;
  const boxH = 401;
  const leftX = boxX + 7;
  const rightX = boxX + 277;
  const colW = 238;
  doc.rect(boxX, boxY, boxW, boxH).lineWidth(0.7).strokeColor("#444448").stroke();

  doc.font(FONT_BOLD).fontSize(6.4).fillColor(TEXT).text("Policy number", leftX, 97);
  codeValue(doc, data.policyNumber, leftX, 108, 5.8);
  doc.font(FONT_BOLD).fontSize(6.4).text("1. Description of vehicle", leftX, 135);
  doc.font(FONT_REGULAR).fontSize(5.9).text(
    `${data.vehicleMake} ${data.vehicleModel} (${data.vehicleColour}, ${data.vehicleYear}) with registration mark ${data.registration} and VIN ${data.vin}`,
    leftX,
    147,
    { width: colW, lineGap: 1 },
  );
  doc.font(FONT_BOLD).fontSize(6.4).text("2. Name of policyholder", leftX, 183);
  doc.font(FONT_REGULAR).fontSize(5.9).text(data.customerName, leftX, 195, { width: colW });
  doc.font(FONT_BOLD).fontSize(6.4).text(
    "3. Effective date of the commencement of insurance for the purposes of the relevant law",
    leftX,
    218,
    { width: colW, lineGap: 1 },
  );
  doc.font(FONT_REGULAR).fontSize(5.9).text(data.validFrom, leftX, 244, { width: colW });
  doc.font(FONT_BOLD).fontSize(6.4).text("4. Date of expiry of insurance", leftX, 270);
  doc.font(FONT_REGULAR).fontSize(5.9).text(data.validUntil, leftX, 282, { width: colW });

  doc.font(FONT_BOLD).fontSize(6.4).text("5. Persons or classes of persons entitled to drive", rightX, 97, { width: colW });
  doc.font(FONT_REGULAR).fontSize(5.9).text("Policyholder only", rightX, 111, { width: colW });
  doc.text(
    "Provided that the person driving holds a licence and is not disqualified from holding or obtaining such a licence.",
    rightX,
    137,
    { width: colW, lineGap: 1 },
  );
  doc.font(FONT_BOLD).fontSize(6.4).text("6. Limitations as to use", rightX, 171);
  doc.font(FONT_REGULAR).fontSize(5.9).text("This insurance covers all of the following:", rightX, 185, { width: colW });
  const coverItems = [
    "social, domestic, and pleasure purposes",
    "travel between the policyholder's home and permanent place of work",
    "class 1 business use",
  ];
  let y = 202;
  for (const item of coverItems) {
    doc.text(`•  ${item}`, rightX + 5, y, { width: colW - 5, lineGap: 1 });
    y += doc.heightOfString(`•  ${item}`, { width: colW - 5, lineGap: 1 }) + 2;
  }
  y += 3;
  doc.text("This insurance does not cover any of the following:", rightX, y, { width: colW });
  y += 17;
  const exclusions = [
    "racing, pacemaking, speed testing, rallies, trials or competitions on (but not limited to) the public highway",
    "the carriage of passengers and/or goods for hire and reward purposes, letting on hire or use for any purpose in connection with the motor trade",
    "securing the release of a motor vehicle (other than the vehicle described in the schedule) which has been seized by or on behalf of any Government or Public Authority.",
  ];
  for (const item of exclusions) {
    doc.text(`•  ${item}`, rightX + 5, y, { width: colW - 5, lineGap: 1 });
    y += doc.heightOfString(`•  ${item}`, { width: colW - 5, lineGap: 1 }) + 2;
  }

  doc.font(FONT_REGULAR).fontSize(7.2).text(
    "I hereby certify that the Insurance to which this Certificate relates satisfies the requirements of the relevant law applicable in Great Britain, Northern Ireland, the Isle of Man, the Island of Guernsey, the Island of Jersey and the Island of Alderney.",
    leftX,
    335,
    { width: boxW - 14, lineGap: 2 },
  );
  doc.text("For and on behalf of Authorised Insurers - Wakam.", leftX, 374);
  doc.image(path.join(ASSET_DIR, "wakam-signature.jpg"), leftX, 391, { width: 82 });
  doc.fontSize(5.5).text(
    "Wakam UK Limited is a company registered in England and Wales with company number 14778827, having its registered office at 18th & 19th Floors 100 Bishopsgate, London, United Kingdom, EC2N 4AG. Authorised by the Prudential Regulation Authority and regulated by the Financial Conduct Authority and the Prudential Regulation Authority under Firm Reference Number 995565.",
    leftX,
    430,
    { width: boxW - 14, lineGap: 1 },
  );
  doc.font(FONT_BOLD).fontSize(5.5).text("Advice to third parties:", leftX, 466, { continued: true });
  doc.font(FONT_REGULAR).text(
    " nothing contained in this certificate affects your right as a third party to make a claim. For full details of the insurance cover, reference should be made to the policy booklet and schedule.",
    { width: boxW - 14, lineGap: 1 },
  );
};

const pageFour = (doc) => {
  addPage(doc);
  const paragraphs = [
    "The certificate of motor insurance, and motor insurance policy to which it relates applies in respect of incidents occurring in member countries of the European Union. Cover also applies in other countries which have satisfied the requirements of the Commission of European Union as follows: Andorra, Iceland, Liechtenstein, Norway, Serbia and Switzerland.",
    "The certificate of motor insurance and the motor insurance policy to which it relates applies to any trailer whilst being towed by the motor vehicle shown on the certificate of motor insurance.",
    "Le Certificat et la police d’assurance qui s’y rattache s’appliquent au regard d’incidents ayant lieu dans les pays membres de l’Union Europẻene. La couverture s’acquiert ẻgalement dans d’autres pays qui ont rempli les conditions de la Commission de l’Union Europẻene, c’est-ả-dire: Andorre, la Islande, la Norvẻge, la Serbie, la Liechtenstein, et la Suisse.",
    "Les Certificat et la police d’assurance qui s’y rattache s’appliquent ả toute remorque ẻtant tractẻe par le vẻhicule dont il est fait mention dans le Certificat.",
    "Das Zertifikat und die diesbezűgliche Versicherungspolice gewähren Versicherungsshutz für Versicherungsfälle in den Mitgliedslänern der EG. Der Geltungsbereich erstreckt sich ferner auf solche anderen Länder, die Erfordernisse der EG-Kommission erfült haben, nämlich: Andorra, Norwegen, Serbien Liechtenstein und die Schweiz.",
    "Das Zertifikat und die diesbezüglich Versicherungspolice gewähren Deckung Für Anhänger des auf dem Zertifikat angegebenen Fahrzeungs.",
    "Il certificate e la polizza di assicurazione a cui fa riferimento si applicano per gli incidenti che occorrono nei paesi della Unione Europea. L’assicurazione si applica anche per gli altri paesi che hanno soddisfatto le esigenze delle Commissione della Unione Europea, cioẻ: Islanda, Norvegia, Liechtenstein, Serbia e Svizzera.",
    "Il certificate e el polizza di assicurazione a cui si riferisce, si applicano a qualsiasi rimorchio che venga trainato dal veicolo indicato sul certificate.",
    "El Certificado y la Póliza de Seguro correspondiente, cubren los accidentes que ocurran en cualquiera de los países miembros de la Unión Europea. Asimismo cubren los accidentes que ocurran en los siguientes países que reúnen las condiciones exigidas por la Cornisión de la Unión Europea: Andorra, Islandia, Noruega, Liechtenstein, Serbia y Suiza.",
    "El Certificado y la Póliza de seguro correspondiente cubren a cualquier remolque mientras vaya arrastrado por en el Certificado.",
  ];
  let y = 30;
  doc.font(FONT_REGULAR).fontSize(8.2).fillColor(TEXT);
  for (const paragraph of paragraphs) {
    const paragraphHeight = doc.heightOfString(paragraph, {
      width: CONTENT_WIDTH - 8,
      lineGap: 2,
    });
    doc.rect(MARGIN_X, y - 1, 3, paragraphHeight + 2).fill("#ededee");
    doc.fillColor(TEXT).text(paragraph, MARGIN_X + 8, y, {
      width: CONTENT_WIDTH - 8,
      lineGap: 2,
    });
    y += paragraphHeight + 12;
  }
};

const generatePolicyCertificatePdf = async ({ policy, customer, vehicle }) => {
  if (!policy || !customer || !vehicle) {
    throw new Error("Policy, customer and vehicle data are required.");
  }

  const data = buildDocumentData({ policy, customer, vehicle });
  const qrBuffer = await QRCode.toBuffer(data.policyNumber, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: 225,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const doc = setupDocument();
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  pageOne(doc, data);
  pageTwo(doc, data, qrBuffer);
  pageThree(doc, data);
  pageFour(doc);
  doc.end();

  return completed;
};

module.exports = {
  generatePolicyCertificatePdf,
  buildDocumentData,
  calculatePaymentBreakdown,
};
