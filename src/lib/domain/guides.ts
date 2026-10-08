import { planFor } from "./features";
import { GYM_ACCOUNTING, GYM_GST, GYM_MANAGEMENT } from "./gym-pages";
import { lowestGymPrice, rupeesLabel, TRIAL_DAYS } from "./pricing";

// The guides at /guides: plain answers to what gym owners in India search for about their accounts, each leading to the
// product page that does the job. Like gym-pages.ts, a sentence about FITRON must be something the console really does.
// General tax statements are general information and say so; amounts in examples are examples and say so.
// No named competitors, no ratings, no promised results.

export type GuideSection = { id: string; heading: string; body: readonly string[]; points?: readonly string[] };

export type Guide = {
  slug: string;
  /** What links to this guide say. */
  label: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  /** The day the guide was first published (ISO date). */
  published: string;
  sections: readonly GuideSection[];
  faq: readonly { q: string; a: string }[];
  /** The product page the guide leads to: [what the link says, path]. */
  product: readonly [label: string, href: string];
};

const from = `${TRIAL_DAYS}-day free trial, from ${rupeesLabel(lowestGymPrice("MONTHLY"))} a month`;
const NOT_ADVICE = "This guide is general information, not tax advice. Rules and rates change, so confirm what applies to your gym with your accountant.";

export const GYM_ACCOUNTS_GUIDE: Guide = {
  slug: "gym-accounting-guide",
  label: "How to manage a gym's accounts",
  title: "Gym Accounting in India: How to Manage a Gym's Accounts | FITRON",
  description: "A practical guide to gym accounting in India: what to record, a daily and monthly routine, dues, GST, expenses and profit and loss, and when software helps.",
  h1: "Gym accounting in India: how to manage your gym's accounts",
  intro:
    "Most gyms start with a fee register, a few WhatsApp messages and an Excel sheet. That works until you have a hundred members, three ways to pay and an accountant asking for the month's numbers. This guide sets out what a gym needs to record, a simple routine to keep it right, and the reports that tell you whether the gym is making money.",
  published: "2026-10-06",
  sections: [
    {
      id: "what-to-record",
      heading: "What a gym needs to record",
      body: ["Gym accounting is the record of every rupee that comes in and goes out, tied to the member, the plan or the bill it belongs to. For a typical Indian gym that means:"],
      points: [
        "Income: new memberships, renewals, personal training, registration fees and product sales such as supplements and water",
        "Payments: how each one was paid (UPI, cash, card or bank transfer) and on which date",
        "Dues: what each member still owes after a part payment",
        "Expenses: rent, salaries, electricity, repairs, marketing and every other cost, with the bill",
        "Purchases and equipment: stock you buy for resale and machines you will use for years",
        "GST: the tax on each invoice, if your gym is registered",
      ],
    },
    {
      id: "routine",
      heading: "A daily, weekly and monthly routine",
      body: ["Accounts stay right when they are kept a little every day, not rebuilt at the end of the month."],
      points: [
        "Every day: make an invoice for every sale and record the payment the moment it is received. Count the cash against what was recorded.",
        "Every week: go through the outstanding-dues list and the memberships expiring in the next two weeks, and follow up.",
        "Every month: record all the month's expenses with their bills, check the bank and UPI statements against your receipts, and read the profit and loss statement.",
        "After the month ends: send your accountant the invoice register, the expense list and the ledgers, then lock the month so nobody changes it by mistake.",
      ],
    },
    {
      id: "dues",
      heading: "Collections, revenue and dues are not the same number",
      body: [
        "Revenue is what you sold in a period. Collections are the money you actually received. The difference is your dues. A gym can sell ₹5 lakh of memberships in a month, collect ₹4.2 lakh and still have ₹80,000 to chase.",
        "Track dues invoice by invoice, with the number of days each one has been pending. The older a due gets, the less likely it is to be paid, so the list is most useful when you work through it every week.",
      ],
    },
    {
      id: "gst",
      heading: "GST on gym invoices",
      body: [
        "If your gym is registered for GST, every invoice has to carry your GSTIN, an invoice number in sequence, the date, the taxable value and the tax. Within your state that tax is split into CGST and SGST; for a sale to someone in another state it is IGST.",
        "At the end of each return period your accountant needs an invoice register: every invoice with its taxable value and tax. Keeping that register as you go saves days of work at return time.",
      ],
    },
    {
      id: "pl",
      heading: "Profit and loss: is the gym making money?",
      body: [
        "The profit and loss statement takes the revenue of a period and subtracts the expenses of the same period, including depreciation on equipment. Reading it every month, split by income type, shows which part of the gym earns and which part costs.",
      ],
    },
    {
      id: "tools",
      heading: "Register, Excel or gym accounting software?",
      body: [
        "A register is cheap but cannot total itself, cannot remind anyone and is easily lost. Excel can total, but every sheet is typed by hand, two people cannot safely edit it at once, and nothing stops a past month from being changed.",
        `Gym accounting software makes the invoice when you sell, keeps the dues list up to date by itself, sends reminders and produces the GST register and profit and loss without retyping. FITRON Gym Accounting does all of this for gyms in India, with a ${from}.`,
      ],
    },
  ],
  faq: [
    {
      q: "What is gym accounting?",
      a: "Gym accounting is the record of a gym's income, payments, dues, expenses and profit: membership fees, renewals, personal training and product sales coming in, and rent, salaries and other costs going out, with the invoices and bills behind them.",
    },
    {
      q: "Can I manage my gym's accounts in Excel?",
      a: "You can, and many gyms start that way. It gets harder as the gym grows: entries are typed twice, dues have to be worked out by hand, and nothing stops an old month from being edited. Gym accounting software does these steps for you.",
    },
    {
      q: "What reports does my accountant need from the gym?",
      a: "Usually the invoice register (with GST if you charge it), the list of expenses with bills, the receipts by payment method, and the ledgers or cash and bank book for the period.",
    },
  ],
  product: ["Gym accounting software", GYM_ACCOUNTING.path],
};

export const GST_GUIDE: Guide = {
  slug: "gst-on-gym-membership",
  label: "GST on gym membership fees",
  title: "GST on Gym Membership in India: Rate, Invoice & Example | FITRON",
  description: "GST on gym membership fees in India: the rate, when a gym must register, CGST and SGST or IGST, what goes on the invoice, and worked examples.",
  h1: "GST on gym membership fees in India",
  intro: `Gym owners ask the same questions about GST: do I have to charge it, at what rate, and what does the invoice need to show? Here are the general rules and two worked examples. ${NOT_ADVICE}`,
  published: "2026-10-06",
  sections: [
    {
      id: "rate",
      heading: "The GST rate on gym services",
      body: [
        "Gym, health club and fitness centre services are generally taxed at 18% GST. They fall under SAC 999723, services of physical well-being including health club and fitness centre. Personal training and the membership itself are services; supplements and merchandise you sell at the desk are goods and may carry a different rate.",
      ],
    },
    {
      id: "registration",
      heading: "When a gym has to register for GST",
      body: [
        "A business that supplies services must register once its total turnover in a financial year crosses ₹20 lakh (₹10 lakh in a few special category states). Below that, registration is optional. A gym that is not registered does not charge GST and must not show GST on its bills.",
      ],
    },
    {
      id: "split",
      heading: "CGST and SGST, or IGST",
      body: [
        "When the gym and the place of supply are in the same state, which is the usual case for a membership used at the gym, the 18% is split into 9% CGST and 9% SGST. When the supply is between states, the full 18% is charged as IGST.",
      ],
    },
    {
      id: "example",
      heading: "Worked examples",
      body: [
        "Tax added on top: a plan priced at ₹1,500 before tax is billed as ₹1,500 + CGST 9% (₹135) + SGST 9% (₹135) = ₹1,770.",
        "Tax included in the price: if you advertise ₹1,770 including GST, the taxable value is ₹1,770 ÷ 1.18 = ₹1,500 and the tax is ₹270. Whichever way you price, the invoice shows the taxable value and the tax separately.",
      ],
    },
    {
      id: "invoice",
      heading: "What a GST invoice from a gym shows",
      body: ["A tax invoice generally carries:"],
      points: [
        "The gym's name, address and GSTIN",
        "An invoice number that runs in sequence within the financial year, and the date",
        "The member's name (and GSTIN, if the member is a registered business)",
        "A description of the service and its SAC code",
        "The taxable value, the GST rate and the CGST, SGST or IGST amount",
        "The total amount",
      ],
    },
    {
      id: "returns",
      heading: "Returns and records",
      body: [
        "A registered gym files periodic GST returns that report its sales and the tax on them, so it needs a register of every invoice with its taxable value and tax for each period. Keep the invoices in an unbroken sequence; a gap or a duplicate number is the first thing an accountant will ask about.",
        `FITRON Gym Accounting makes the invoice as you sell, with your GSTIN, SAC code and the CGST and SGST or IGST split at the rate you set, and keeps a GST invoice register you can download for your accountant. It does not file returns.`,
      ],
    },
  ],
  faq: [
    { q: "What is the GST rate on gym membership?", a: "Gym and fitness centre services are generally taxed at 18% GST, split as 9% CGST and 9% SGST within a state, or 18% IGST between states. Confirm the rate that applies to your gym with your accountant." },
    { q: "Does a small gym have to charge GST?", a: "Only if it is registered for GST. Registration is required once a service business's turnover in a financial year crosses ₹20 lakh (₹10 lakh in a few special category states); below that it is optional." },
    { q: "What is the SAC code for gym services?", a: "Gym, health club and fitness centre services generally fall under SAC 999723. Your accountant can confirm the code for your gym's services." },
    { q: "How do I work out GST if my price already includes it?", a: "Divide the price by 1.18 to get the taxable value; the rest is the tax. For ₹1,770 including 18% GST, the taxable value is ₹1,500 and the tax is ₹270." },
  ],
  product: ["GST invoice software for gyms", GYM_GST.path],
};

export const PL_GUIDE: Guide = {
  slug: "gym-profit-and-loss",
  label: "How to calculate a gym's profit and loss",
  title: "Gym Profit and Loss: How to Calculate It (with Example) | FITRON",
  description: "How to work out a gym's monthly profit and loss: the income and expense lines to include, depreciation on equipment, a worked example and the numbers to watch.",
  h1: "How to calculate your gym's profit and loss",
  intro:
    "A busy gym floor does not always mean a profitable gym. The profit and loss statement (P&L) answers the question properly: in a given month, did the gym earn more than it spent? Here is how to build one, with an example.",
  published: "2026-10-06",
  sections: [
    {
      id: "formula",
      heading: "The formula",
      body: ["Net profit = revenue − expenses − depreciation, all for the same period. Revenue is what you sold in the period, whether or not it has been paid yet; money still owed sits in dues, not in a separate line."],
    },
    {
      id: "revenue",
      heading: "Revenue lines",
      body: ["Split revenue so you can see what earns:"],
      points: ["New memberships", "Renewals", "Personal training", "Registration fees", "Product sales (supplements, water, merchandise)"],
    },
    {
      id: "expenses",
      heading: "Expense lines",
      body: ["Group costs into a few categories you keep using every month:"],
      points: ["Rent", "Salaries, trainer commissions and incentives", "Electricity and water", "Repairs and maintenance", "Marketing", "Stock bought for resale", "Software, internet and other running costs"],
    },
    {
      id: "depreciation",
      heading: "Equipment and depreciation",
      body: [
        "A ₹6 lakh set of machines is not an expense of the month you bought it. It is an asset that loses value over its useful life, and the P&L carries a share of that loss each month as depreciation, by the written-down value or the straight-line method. Leaving it out makes a gym look more profitable than it is.",
      ],
    },
    {
      id: "example",
      heading: "A worked example",
      body: [
        "Example figures for one month: revenue of ₹4,00,000 (memberships and renewals ₹3,20,000, personal training ₹55,000, registration ₹10,000, products ₹15,000). Expenses of ₹2,90,000 (rent ₹1,20,000, salaries ₹1,10,000, electricity ₹35,000, other ₹25,000). Depreciation of ₹10,000.",
        "Net profit = ₹4,00,000 − ₹2,90,000 − ₹10,000 = ₹1,00,000, a 25% margin on revenue.",
      ],
    },
    {
      id: "watch",
      heading: "Numbers to read next to the P&L",
      points: [
        "Outstanding dues: revenue you have earned but not collected",
        "Renewals due and renewed: lost renewals are the most common cause of a falling P&L",
        "Revenue by plan: which plans members actually buy",
        "Cash and bank book: whether the cash is there to pay next month's rent",
      ],
      body: [],
    },
    {
      id: "software",
      heading: "Let the P&L build itself",
      body: [
        `In FITRON Gym Accounting every sale, payment and expense lands in the same books, so the profit and loss statement for this month, last month, the quarter or the financial year is ready without retyping, split by income type and with depreciation from the fixed asset register. It comes with the ${planFor("accounting").name} and Enterprise plans.`,
      ],
    },
  ],
  faq: [
    { q: "How do I calculate my gym's monthly profit?", a: "Add up the month's revenue (memberships, renewals, personal training, registration fees and product sales), subtract the month's expenses and the depreciation on equipment. What is left is net profit." },
    { q: "Should equipment purchases go in the monthly expenses?", a: "No. Equipment is an asset. Its cost is spread over its useful life as depreciation, and only the depreciation for the month goes in that month's P&L." },
    { q: "What is the difference between profit and cash?", a: "Profit counts what you sold, paid or not. Cash counts what you received and spent. A gym with high dues can show a profit and still be short of cash." },
  ],
  product: ["Gym accounting software with P&L", GYM_ACCOUNTING.path],
};

export const MOVE_GUIDE: Guide = {
  slug: "gym-fee-register-to-software",
  label: "Moving from a fee register or Excel to software",
  title: "Gym Fee Register to Software: Move Your Members and Fees | FITRON",
  description: "How to move your gym from a fee register or Excel to gym management software: what to prepare, how the import works, and what to check in the first week.",
  h1: "Moving your gym from a fee register or Excel to software",
  intro:
    "Switching from a paper register or a spreadsheet sounds like weeks of typing. It does not have to be. With a clean list of members and their plans, most of the move is one import and an afternoon of checking.",
  published: "2026-10-06",
  sections: [
    {
      id: "prepare",
      heading: "What to prepare",
      body: ["Put your members into one spreadsheet, one row per member, with these columns:"],
      points: ["Name and mobile number", "Membership plan and its price", "Start date and expiry date", "Amount paid and amount still due", "Optional: email, date of birth, gender and address"],
    },
    {
      id: "clean",
      heading: "Clean the list first",
      body: [
        "Remove duplicates, write every date in one format, and check that each mobile number has ten digits. Ten minutes spent here saves an hour of fixing members one by one later.",
      ],
    },
    {
      id: "import",
      heading: "Import, then check",
      body: [
        "Save the sheet as CSV and import it. In FITRON, the importer matches your columns, shows every row in a preview before anything is saved, and tells you how many rows it skipped and why. It takes up to 5,000 rows at a time, and payments, expenses, products and assets can be imported the same way.",
      ],
    },
    {
      id: "first-week",
      heading: "The first week",
      points: [
        "Make every new sale and renewal in the software, not the register",
        "Check the renewals list against your register once",
        "Check the outstanding-dues list against what members say they owe",
        "Give each staff member a login with only the access their role needs",
      ],
      body: [],
    },
    {
      id: "software",
      heading: "Try it with your own members",
      body: [`FITRON Gym Accounting is gym management and accounting software built for gyms in India. Import your member list during the ${from}; nothing is charged unless you choose a plan.`],
    },
  ],
  faq: [
    { q: "Can I import my members from Excel?", a: "Yes. Save the sheet as CSV and import it. FITRON matches your columns, previews every row before saving, and imports up to 5,000 rows at a time." },
    { q: "Do I need to enter old payments?", a: "Bring in what members still owe so the dues list is right from day one. Older paid history is optional; keep the old register or sheet for reference." },
  ],
  product: ["Gym management software", GYM_MANAGEMENT.path],
};

export const GUIDES = [GYM_ACCOUNTS_GUIDE, GST_GUIDE, PL_GUIDE, MOVE_GUIDE] as const;

export const GUIDES_PATH = "/guides";
export const guidePath = (g: Guide) => `${GUIDES_PATH}/${g.slug}`;
export const findGuide = (slug: string) => GUIDES.find((g) => g.slug === slug);
