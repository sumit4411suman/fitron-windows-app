import { FEATURES, planFor, type Feature } from "./features";
import { findPlan, lowestGymPrice, rupeesLabel, TRIAL_DAYS } from "./pricing";
import { gstPreview } from "./tax";

// The words of the three public pages about Gym Accounting (/gym-accounting, /gym-management-software,
// /gym-gst-billing). Everything here is a statement about what the console really does, written from the code:
// a section that belongs to a plan carries its `feature`, and the page names the cheapest plan that opens it
// (planFor), so a change to src/lib/domain/features.ts reaches these pages. gym-pages.test.ts checks the rest.
// Do not add a claim the console cannot back: no "compliant", no tax advice, no named competitors, no ratings.

export type Block = {
  id: string;
  heading: string;
  body: string;
  points?: readonly string[];
  /** The plan feature this section needs; the page says which plan opens it. Left out for what every plan has. */
  feature?: Feature;
  link?: readonly [label: string, href: string];
  /** Real screenshots of the console (public/site/features), shown under the section. */
  shots?: readonly Shot[];
};

/** A screenshot of the console's demo gym, with the text a screen-reader reads instead of it. All are 1280 × 760 WebP. */
export type Shot = { src: string; alt: string; width: 1280; height: 760 };
const shot = (file: string, alt: string): Shot => ({ src: `/site/features/${file}.webp`, alt, width: 1280, height: 760 });

export type Faq = { q: string; a: string };

export type GymPage = {
  path: string;
  /** What links to this page say. */
  label: string;
  title: string;
  description: string;
  kicker: string;
  h1: string;
  intro: string;
  blocks: readonly Block[];
  faq: readonly Faq[];
};

const starter = findPlan("starter")!;
const professional = findPlan("professional")!;
const enterprise = findPlan("enterprise")!;
const trial = `${TRIAL_DAYS}-day free trial`;
const MESSAGING = "WhatsApp messages are sent through your own WhatsApp Business connection and are subject to usage limits and messaging charges.";

/** The sentence the Billing & GST settings show as an example, at the rate we quote it for. */
const gstExample = gstPreview({ enabled: true, rate: 18, type: "CGST+SGST" }, "", 0).split(" Next invoice")[0]!;

const priceAnswer =
  `Gym Accounting is ${rupeesLabel(starter.price.MONTHLY)} a month for Starter (up to ${starter.memberLimit} active members), ` +
  `${rupeesLabel(professional.price.MONTHLY)} for Professional (up to ${professional.memberLimit}) and ${rupeesLabel(enterprise.price.MONTHLY)} for Enterprise ` +
  `(unlimited members and multiple branches). Prices include GST and yearly plans are billed upfront. Every plan starts with a ${trial}.`;

const opens = (f: Feature) => planFor(f).name;

export const GYM_ACCOUNTING: GymPage = {
  path: "/gym-accounting",
  label: "Gym accounting software",
  title: "Gym Accounting Software for Indian Gyms | FITRON",
  description: `Manage gym members, fees, GST invoices, expenses, payments, profit & loss and reports with FITRON Gym Accounting. Start your ${trial}.`,
  kicker: "FITRON Gym Accounting",
  h1: "Gym accounting software for Indian gyms",
  intro:
    "FITRON Gym Accounting keeps your gym's money in one place: what members owe, what they have paid, what you spent and what the gym earned. Every sale becomes a numbered invoice, every expense is recorded, and each month ends with a profit and loss statement.",
  blocks: [
    {
      id: "fees",
      shots: [shot("invoices", "FITRON Gym Accounting invoice list showing numbered invoices with their members, totals, balances and Paid or Overdue status"), shot("receivables", "FITRON Gym Accounting outstanding payments screen listing overdue invoices with the amount pending, days overdue and a Collect button")],
      heading: "Membership fees, invoices and dues",
      body: "Sell a membership and FITRON creates a numbered invoice for it. Record the payment as UPI, cash, card or bank transfer. If a member pays part of the amount, the balance stays on their invoice as an outstanding amount until it is cleared.",
      points: [
        "Numbered invoices with a prefix of your choice, as PDFs you can send or print",
        "Discounts, offer codes and a registration fee on the sale",
        "Part payments tracked invoice by invoice",
        "An outstanding-dues list showing who owes what and for how many days",
        "A renewals list that tracks every expiry for you",
      ],
    },
    {
      id: "gst",
      shots: [shot("invoice", "A FITRON GST invoice with the gym name and GSTIN, the member, line items, the CGST 9% and SGST 9% split, the grand total and the amount in words")],
      heading: "GST on every invoice",
      body: "Turn GST on in the Billing & GST settings, set the rate, choose whether it is split into CGST and SGST or charged as IGST, and set your SAC code. Your gym's GSTIN prints on the invoice, and each invoice keeps the rate it was issued with, so changing the rate later does not touch old invoices.",
      points: ["CGST + SGST or IGST on every invoice", "A GST invoice register with taxable value, CGST, SGST, IGST and total for any period", "GST can be switched off for a gym that does not charge it"],
      link: ["How GST billing works for a gym", "/gym-gst-billing"],
    },
    {
      id: "expenses",
      shots: [shot("expenses", "FITRON Gym Accounting expenses screen with the month total, a monthly expense trend and each expense with its category, vendor and payment method")],
      heading: "Expenses",
      body: "Record rent, utilities, repairs and every other cost against a category, with the vendor, the bill number and how it was paid. The expense list shows them by date, category and group.",
    },
    {
      id: "pl",
      shots: [shot("accounting", "FITRON Gym Accounting profit and loss statement for the month, with revenue, expenses and a reconciliation of invoices, collections and receivables")],
      heading: "Profit and loss",
      feature: "accounting",
      body: "See revenue, expenses and net profit for this month, last month, this quarter, this financial year or any dates you pick. Revenue is split into membership, renewals, personal training, registration fees and product sales, and the statement carries the depreciation on your equipment.",
    },
    {
      id: "ledgers",
      shots: [shot("ledger", "FITRON Gym Accounting payment ledger listing each payment with its invoice, member, method and status, with tabs for the other ledgers and a CSV export")],
      heading: "Ledgers and the cash and bank book",
      feature: "accounting",
      body: "Open the income, expense, payment and receivable ledgers for any period, and a cash and bank book of the money that came in and went out. Each entry links back to the invoice, payment or bill it came from, and the ledgers download as CSV.",
    },
    {
      id: "purchases",
      shots: [shot("purchases", "FITRON Gym Accounting purchases screen listing vendor bills with their totals, amounts paid, balance and Paid or Part paid status"), shot("assets", "FITRON Gym Accounting fixed assets register with gross block, accumulated depreciation and net book value for each asset")],
      heading: "Purchases, vendor bills and fixed assets",
      feature: "accounting",
      body: "Record purchases of stock, equipment and expenses by supplier, and see what you still owe each one. Equipment goes into a fixed asset register that works out depreciation (written-down value or straight-line), month by month and for the financial year, and records the gain or loss when you sell an asset.",
    },
    {
      id: "close",
      shots: [shot("close", "FITRON Gym Accounting month-end closing screen with the month summary and a button to lock the month")],
      heading: "Month-end closing and lock",
      feature: "accounting",
      body: "The month-end view shows revenue, expenses, net profit, cash and what is still receivable, and reconciles them. Once a month has ended you can lock it: after that only the Super Admin can add or change entries dated in it, and every unlock is recorded in the audit log.",
    },
    {
      id: "reports",
      shots: [shot("report-gst", "FITRON Report Center showing the GST invoice register with taxable value, CGST, SGST and IGST, and CSV, Excel and PDF download buttons")],
      heading: "Reports you can download",
      body: "Collections, revenue by category, sales by plan, the GST invoice register and GST summary, the expense list, outstanding dues, memberships about to expire and member reports such as active, expired, new, renewals and retention open in the app and download as CSV or Excel files. Profit and loss, cash flow, purchases, vendor payables and the fixed-asset reports come with the accounting features.",
      points: ["Excel and CSV files you can pass to your accountant", "FITRON does not create a Tally import file"],
    },
    {
      id: "branches",
      shots: [shot("dashboard", "FITRON Gym Accounting dashboard with a branch comparison table showing active members, collections, expenses and outstanding dues for each branch")],
      heading: "One gym or every branch",
      feature: "analytics",
      body: "Run a single gym, or a chain: each branch keeps its own members, invoices and expenses, and you can see one branch or all of them together, with branch-wise revenue and expenses and a consolidated view.",
    },
    {
      id: "trust",
      shots: [shot("audit", "FITRON audit log listing who did what and when, with the integrity check, filters by module and severity, and CSV and Excel export")],
      heading: "Who changed what",
      body: "Every change in Gym Accounting is written to an audit log, staff see only what their role allows, and your data is hosted in India. You can back it up and restore it from Settings, and import members, payments, expenses, products and assets from CSV files when you move over from registers or spreadsheets.",
      link: ["Read the privacy policy", "/privacy"],
    },
  ],
  faq: [
    {
      q: "What is gym accounting software?",
      a: "Gym accounting software records a gym's membership fees, invoices, payments, dues, expenses and profit in one system, in place of fee registers, WhatsApp messages and spreadsheets. FITRON Gym Accounting also runs the front desk: members, renewals, attendance and reminders.",
    },
    { q: "How much does gym accounting software cost?", a: priceAnswer },
    {
      q: "Does FITRON create GST invoices for gym memberships?",
      a: "Yes. When GST is switched on, each invoice shows your GSTIN, your SAC code and the tax split as CGST and SGST or as IGST, at the rate you set. Whether and at what rate your gym should charge GST is a question for your accountant.",
    },
    {
      q: "Which plan includes profit and loss reports?",
      a: `Profit and loss, ledgers, purchases, fixed assets and month-end closing come with ${opens("accounting")} and Enterprise. Starter covers member registration, renewals, payments, dues, expenses and the basic reports.`,
    },
    {
      q: "Can I export my accounts to Excel for my accountant?",
      a: `Yes. Every report downloads as an Excel or CSV file, and the ledgers download as CSV. The accounting reports and ledgers come with ${opens("accounting")} and Enterprise; the basics, such as collections, dues, expenses and the GST invoice register, are on every plan. FITRON does not create a Tally import file.`,
    },
    {
      q: "Can I use it for more than one branch?",
      a: `Yes, on the Enterprise plan: it supports multiple branches with branch-wise and consolidated reports. Extra branches are ${rupeesLabel(49_900)} a month.`,
    },
    {
      q: "Where is my gym's data kept?",
      a: "On servers in India. Passwords are hashed with Argon2, connections use HTTPS, staff access is limited by role and every change is written to an audit log. The privacy policy sets out the details.",
    },
  ],
};

export const GYM_MANAGEMENT: GymPage = {
  path: "/gym-management-software",
  label: "Gym management software",
  title: "Gym Management Software in India: Members & Renewals | FITRON",
  description: `Gym management software for India: members, renewals, attendance, WhatsApp reminders and billing for one gym or a chain. ${trial}, from ${rupeesLabel(lowestGymPrice("MONTHLY"))} a month.`,
  kicker: "FITRON Gym Accounting",
  h1: "Gym management software that runs the front desk and the books",
  intro:
    "Members, renewals, attendance, classes, reminders and billing in one console, so the desk and the accounts always agree. FITRON Gym Accounting is built for gyms in India: rupees, UPI, GST and WhatsApp.",
  blocks: [
    {
      id: "members",
      shots: [shot("members", "FITRON Gym Accounting member list with plan, expiry date, status and outstanding dues, and search and filters")],
      heading: "Members and their records",
      body: "Every member has a profile with their plan, expiry date, dues and documents. Import your existing members from a CSV file (up to 5,000 rows at a time), or add them as they join.",
    },
    {
      id: "renewals",
      shots: [shot("renewals", "FITRON renewals screen listing memberships expiring today, within 7 days and already expired, with Remind and Renew buttons")],
      heading: "Memberships, renewals and freezes",
      body: "Sell a membership plan with discounts, offer codes and a registration fee. Expiries are tracked automatically and collected in a renewals list. A member who is travelling or unwell can freeze a membership, and the unused days are given back when it is unfrozen.",
    },
    {
      id: "attendance",
      shots: [shot("attendance", "FITRON attendance screen with today's check-ins, a front-desk check-in box and a chart of the last 14 days")],
      heading: "Attendance",
      feature: "attendance",
      body: "Check members in at the desk, with a QR code scanned by the camera of a phone or tablet, and see check-ins by day and by hour so you know when the gym is busy.",
    },
    {
      id: "doors",
      heading: "Biometric devices and door access",
      feature: "biometric",
      body: "Connect ZKTeco and eSSL devices that use the ADMS push protocol. Enrol a member's face, fingerprint or RFID card, and their punches at the door arrive as attendance.",
    },
    {
      id: "classes",
      shots: [shot("classes", "FITRON classes timetable for the week showing each class, its time, trainer and how full it is")],
      heading: "Classes, leads and trials",
      feature: "classes",
      body: "Run a timetable of group classes, and keep enquiries, trials and walk-ins as leads that move through stages, each with a follow-up date, so none is forgotten.",
    },
    {
      id: "whatsapp",
      heading: "WhatsApp reminders",
      feature: "whatsapp",
      body: `Messages go out by themselves at the moments that matter: a welcome for a new member, a payment confirmation, a reminder when a balance is pending, and expiry reminders 15, 7, 3 and 1 days before a membership ends and on the day it does. You can edit every message. ${MESSAGING}`,
    },
    {
      id: "pos",
      shots: [shot("pos", "FITRON point of sale and inventory screen with products, prices, stock levels and low-stock warnings")],
      heading: "Point of sale and stock",
      feature: "pos",
      body: "Sell supplements, water and merchandise at the front desk. Stock goes down with each sale, and you can set a reorder level for each product and restock when it is reached.",
    },
    {
      id: "autopay",
      heading: "UPI autopay for renewals",
      feature: "autopay",
      body: "Send a member a link to approve UPI autopay in any UPI app. They get a notice a day before each debit, and each successful debit renews the membership and makes its invoice.",
    },
    {
      id: "staff",
      shots: [shot("staff", "FITRON staff and roles screen with each team member, their role, branch, phone and salary")],
      heading: "Staff, payroll and access",
      feature: "staff",
      body: "Add staff and trainers, give each a role that decides what they can open, and work out pay from base salary, personal-training commission, bonus, deductions and advances.",
    },
    {
      id: "accounts",
      heading: "The accounts are built in",
      body: "Every sale, payment and expense lands in the same books, so the invoices, dues, GST register and profit and loss never need to be matched up by hand.",
      link: ["See the accounting features", "/gym-accounting"],
    },
  ],
  faq: [
    {
      q: "What is gym management software?",
      a: "Gym management software handles the daily work of running a gym: member records, membership plans and renewals, attendance, reminders, payments and reports. FITRON adds full accounting to it, so the front desk and the books share the same data.",
    },
    {
      q: "Can I move my existing members into FITRON?",
      a: "Yes. Import members, payments, expenses, products and assets from CSV files. The importer matches your columns, checks every row in a preview before anything is saved, and tells you how many rows it skipped.",
    },
    {
      q: "Which door and biometric devices work with it?",
      a: `Devices from ZKTeco and eSSL that use the ADMS push protocol. This comes with ${opens("biometric")} and Enterprise.`,
    },
    {
      q: "Does it send WhatsApp reminders for expiring memberships?",
      a: `Yes, on ${opens("whatsapp")} and Enterprise. Reminders go out 15, 7, 3 and 1 days before a membership ends and on the expiry day, and you can edit the wording. ${MESSAGING}`,
    },
    { q: "How much does gym management software cost?", a: priceAnswer },
    {
      q: "Can a gym with several branches use it?",
      a: "Yes, on the Enterprise plan: members, invoices and expenses are kept per branch, and you can look at one branch or all of them together.",
    },
  ],
};

export const GYM_GST: GymPage = {
  path: "/gym-gst-billing",
  label: "GST invoices for gyms",
  title: "GST Invoice Software for Gyms: CGST, SGST, IGST | FITRON",
  description: `GST billing for gyms in India: numbered invoices with your GSTIN, CGST and SGST or IGST, and a GST invoice register for your accountant. ${trial}.`,
  kicker: "FITRON Gym Accounting",
  h1: "GST invoices for your gym, made as you sell",
  intro:
    "When you sell a membership, renew a plan or record a payment in FITRON, the invoice is made for you: numbered, with your GSTIN, and with the tax worked out. Here is exactly what it does, and what it leaves to your accountant.",
  blocks: [
    {
      id: "setup",
      heading: "Set GST up once",
      body: "In Settings, under Billing & GST, switch GST on, set the rate, choose CGST and SGST (for sales within your state) or IGST (for sales between states), enter your SAC code and your GSTIN, and choose the prefix of your invoice numbers.",
      points: ["The tax is added on top of the plan price", gstExample, "Invoice numbers keep counting from where they are; changing the prefix does not restart them"],
    },
    {
      id: "invoice",
      shots: [shot("invoice", "A FITRON GST invoice with the gym name and GSTIN, the member, line items, the CGST 9% and SGST 9% split, the grand total and the amount in words")],
      heading: "What is on the invoice",
      body: "Each invoice is a numbered PDF with your gym's name and GSTIN, the member's details, the lines sold, the tax split and the total, with your SAC code in the footer. Each invoice keeps the rate it was issued with, so changing the rate later does not touch old invoices.",
    },
    {
      id: "register",
      shots: [shot("report-gst", "FITRON GST invoice register with taxable value, CGST, SGST and IGST for each invoice, and CSV, Excel and PDF download buttons")],
      heading: "The GST invoice register",
      body: "Pick a period and the register lists every invoice with its date, number, member, taxable value, CGST, SGST, IGST and total. It opens in the app and downloads as a CSV or Excel file, which is what your accountant needs when preparing your return.",
      link: ["More on gym accounting", "/gym-accounting"],
    },
    {
      id: "send",
      heading: "Getting the invoice to the member",
      feature: "whatsapp",
      body: `Send the invoice PDF to the member over WhatsApp, and see payment confirmations and balance reminders go out by themselves. ${MESSAGING}`,
    },
    {
      id: "limits",
      heading: "What FITRON does not do",
      body: "FITRON makes the invoices and the register. It does not file GST returns and it does not create e-invoices. Your accountant files the return from the register and the other exports.",
    },
  ],
  faq: [
    {
      q: "Can a gym issue GST invoices from FITRON?",
      a: "Yes. With GST switched on, every invoice shows your GSTIN, your SAC code and the tax split as CGST and SGST or as IGST, at the rate you set.",
    },
    {
      q: "Does FITRON work out CGST and SGST?",
      a: `Yes. At 18%, for example, a plan of ₹1,500 is billed as ₹1,500 plus CGST 9% and SGST 9%, ₹1,770 in all. For sales between states you choose IGST instead.`,
    },
    {
      q: "Can I change the GST rate later?",
      a: "Yes. The new rate applies to invoices made after the change. Invoices already issued keep the rate they were made with.",
    },
    {
      q: "Does FITRON file my GST return?",
      a: "No. FITRON gives you the invoices and a GST invoice register for any period, which downloads as CSV or Excel. Your accountant files the return.",
    },
    {
      q: "Does my gym have to charge GST?",
      a: "That depends on your gym's turnover and registration, so ask your accountant. If your gym does not charge GST, switch it off and invoices show no tax.",
    },
    { q: "How much does it cost?", a: priceAnswer },
  ],
};

export const GYM_PAGES = [GYM_ACCOUNTING, GYM_MANAGEMENT, GYM_GST] as const;

/** The plan line shown on a section that belongs to a plan, e.g. "Included from Professional". */
export const planNote = (f: Feature) => `Included from ${planFor(f).name}`;
export const featureLabel = (f: Feature) => FEATURES[f].label;
