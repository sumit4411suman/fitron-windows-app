// Demo gym for development and previews. Sign in with any demo email and the
// password "fitron-demo". Never run this against a production database.
import { makeClient } from "./client";
import { ensureExpenseCategories, ensureRoles } from "./roles";
import { hashPassword } from "../src/lib/auth/password";
import { invoiceTotals } from "../src/lib/domain/billing";
import { addDays, addMonths } from "../src/lib/domain/dates";

const db = makeClient();
const DEMO_PASSWORD = "fitron-demo";

// Deterministic so every seed looks the same.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const MALE = ["Rahul", "Amit", "Vikash", "Rohit", "Saurabh", "Ankit", "Manish", "Deepak", "Abhishek", "Gaurav", "Aditya", "Karan", "Suraj", "Nikhil", "Ravi"];
const FEMALE = ["Priya", "Sneha", "Anjali", "Pooja", "Neha", "Riya", "Kajal", "Shreya", "Nisha", "Swati", "Tanya", "Divya"];
const LAST = ["Kumar", "Singh", "Sharma", "Verma", "Gupta", "Mahto", "Das", "Sinha", "Jha", "Oraon", "Tudu", "Mishra"];
const AREAS = ["Sector 4", "Sector 9", "Chas", "City Centre", "Sector 12", "Naya More"];
const SOURCES = ["Walk-in", "Friend", "Instagram", "Google", "Flyer"];
const METHODS = ["UPI", "Cash", "Card", "UPI", "UPI"];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");
  // Roles and categories are refreshed every run, so older databases pick up new ones.
  const roles = await ensureRoles(db);
  await ensureExpenseCategories(db);
  // The demo gym is found by its flag, its name, or (after a rename and a "Clear demo data") its kept owner account.
  const existing = await db.organization.findFirst({
    where: { OR: [{ demo: true }, { name: "Power Haus Gym (demo)" }, { users: { some: { email: "sumit@demo.fitron.in" } } }] },
    orderBy: { createdAt: "asc" },
  });
  if (existing && !existing.demo) {
    console.log("Demo data was cleared on this gym; roles and categories refreshed, nothing re-seeded.");
    return;
  }
  if (existing) {
    const added = await seedFrontDesk(existing.id);
    const assets = await seedAssets(existing.id);
    const mandates = await seedAutopay(existing.id);
    const running = await seedRunningCosts(existing.id);
    console.log(`Demo gym already exists; roles and categories refreshed${added ? ", front-desk demo data added" : ""}${assets ? ", assets and purchases added" : ""}${mandates ? ", autopay mandates added" : ""}${running ? ", a year of running costs added" : ""}.`);
    return;
  }
  const org = await db.organization.create({ data: { name: "Power Haus Gym (demo)", demo: true } });
  const [city, chas] = await Promise.all([
    db.branch.create({ data: { orgId: org.id, name: "City Centre", address: "C-7, Sector 4, City Centre, Bokaro", phone: "7319742490", gstin: "20ABCDE1234F1Z5" } }),
    db.branch.create({ data: { orgId: org.id, name: "Chas", address: "Main Road, Chas, Bokaro", phone: "7250981134" } }),
  ]);
  await db.setting.createMany({
    data: [
      { orgId: org.id, key: "gym", value: { name: "Power Haus Gym" } },
      { orgId: org.id, key: "numbering", value: { memberPrefix: "PHG-" } },
    ],
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const staff = [
    ["Sumit Kumar", "Super Admin", "sumit@demo.fitron.in", [city, chas]],
    ["Ritika Sinha", "Admin", "ritika@demo.fitron.in", [city]],
    ["Anand Verma", "Accountant", "accounts@demo.fitron.in", [city, chas]],
    ["Pooja Kumari", "Receptionist", "frontdesk@demo.fitron.in", [city]],
    ["Vikram Singh", "Trainer", "vikram@demo.fitron.in", [city]],
    ["Neha Das", "Receptionist", "chas@demo.fitron.in", [chas]],
    ["Meera Oraon", "Trainer", "meera@demo.fitron.in", [chas]],
  ] as const;
  const users: Record<string, string> = {};
  for (const [name, role, email, branches] of staff) {
    const u = await db.user.create({
      data: {
        orgId: org.id,
        name,
        email,
        phone: `9${ri(100000000, 999999999)}`,
        roleId: roles.get(role)!,
        passwordHash,
        emailVerifiedAt: new Date(),
        ptRate: role === "Trainer" ? 40 : 0,
        salary: ({ Admin: 3000000, Accountant: 2200000, Receptionist: 1500000, Trainer: 1800000 } as Record<string, number>)[role] ?? 0,
        joinedOn: new Date("2024-04-01T00:00:00.000Z"),
        branches: { create: branches.map((b) => ({ branchId: b.id })) },
      },
    });
    users[email] = u.id;
  }

  const planDefs = [
    ["Monthly", 1, 150000, 50000, "Membership", ["Gym floor", "Locker", "Fitness assessment"]],
    ["Quarterly", 3, 400000, 50000, "Membership", ["Gym floor", "Locker", "Diet chart"]],
    ["Half-Yearly", 6, 750000, 50000, "Membership", ["Gym floor", "Locker", "Diet chart", "Body composition"]],
    ["Annual", 12, 1300000, 0, "Membership", ["Gym floor", "Locker", "Diet chart", "2 PT sessions"]],
    ["Personal Training", 1, 500000, 0, "Personal Training", ["12 PT sessions", "Custom program", "Diet plan"]],
    ["Student Monthly", 1, 120000, 30000, "Membership", ["Gym floor", "Off-peak hours"]],
  ] as const;
  const plans = [];
  for (const [name, months, price, regFee, kind, features] of planDefs) {
    plans.push(await db.membershipPlan.create({ data: { orgId: org.id, name, months, price, regFee, kind, features: [...features] } }));
  }
  await db.membershipPlan.create({
    data: { orgId: org.id, name: "Monsoon Offer 2025", months: 2, price: 250000, regFee: 0, kind: "Membership", status: "INACTIVE", features: ["Gym floor"] },
  });

  let memberNo = 1001;
  let invNo = 1001;
  let payNo = 5001;
  let msNo = 1;
  const trainers = [users["vikram@demo.fitron.in"], users["meera@demo.fitron.in"]];
  const creator = users["frontdesk@demo.fitron.in"]!;

  for (let i = 0; i < 48; i++) {
    const female = rnd() < 0.4;
    const branch = i % 4 === 3 ? chas : city;
    const plan = pick(plans.slice(0, 4));
    // Spread end dates from 40 days ago to 5 months ahead so every status shows up.
    const end = addDays(today, ri(-40, plan.months * 30));
    const start = addMonths(addDays(end, 1), -plan.months);
    const m = await db.member.create({
      data: {
        orgId: org.id,
        branchId: branch.id,
        code: `PHG-${memberNo++}`,
        name: `${pick(female ? FEMALE : MALE)} ${pick(LAST)}`,
        gender: female ? "Female" : "Male",
        phone: `${pick(["6", "7", "8", "9"])}${String(ri(100000000, 999999999))}`,
        area: pick(AREAS),
        city: "Bokaro",
        state: "Jharkhand",
        source: pick(SOURCES),
        tags: [],
        trainerId: rnd() < 0.5 ? (branch === city ? trainers[0] : trainers[1]) : null,
        suspended: i === 7,
        createdById: creator,
        createdAt: d(start),
      },
    });
    const lines = [
      { qty: 1, rate: plan.price, discount: 0, taxRate: 18 },
      ...(plan.regFee ? [{ qty: 1, rate: plan.regFee, discount: 0, taxRate: 18 }] : []),
    ];
    const t = invoiceTotals(lines);
    const inv = await db.invoice.create({
      data: {
        orgId: org.id,
        branchId: branch.id,
        memberId: m.id,
        number: `INV-${invNo++}`,
        date: d(start),
        dueDate: d(start),
        ...t,
        gstType: "CGST+SGST",
        gstRate: 18,
        status: "ISSUED",
        createdById: creator,
        items: {
          create: lines.map((l, k) => ({
            description: k === 0 ? `${plan.name} membership` : "Registration fee",
            qty: l.qty,
            rate: l.rate,
            discount: l.discount,
            taxRate: l.taxRate,
            taxAmount: Math.round(((l.rate - l.discount) * l.taxRate) / 100),
            amount: l.rate - l.discount,
            category: k === 0 ? "New Membership" : "Registration",
            planId: k === 0 ? plan.id : null,
          })),
        },
      },
    });
    await db.membership.create({
      data: {
        code: `MS-${msNo++}`,
        memberId: m.id,
        planId: plan.id,
        branchId: branch.id,
        type: "NEW",
        startDate: d(start),
        endDate: d(end),
        price: plan.price,
        discount: 0,
        pricingCategory: "Standard",
        invoiceId: inv.id,
      },
    });
    // Most pay in full; some part-pay; a few owe everything.
    const r = rnd();
    const paid = r < 0.75 ? t.total : r < 0.9 ? Math.round(t.total / 2 / 100) * 100 : 0;
    if (paid > 0) {
      await db.payment.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          invoiceId: inv.id,
          memberId: m.id,
          code: `PAY-${payNo++}`,
          date: d(start),
          amount: paid,
          method: pick(METHODS),
          receivedById: creator,
        },
      });
    }
  }
  await db.sequence.createMany({
    data: [
      { orgId: org.id, name: "member", next: memberNo },
      { orgId: org.id, name: "invoice", next: invNo },
      { orgId: org.id, name: "payment", next: payNo },
      { orgId: org.id, name: "membership", next: msNo },
    ],
  });
  await seedFrontDesk(org.id);
  await seedAssets(org.id);
  await seedAutopay(org.id);
  await seedRunningCosts(org.id);
  // The prototype's offer codes, so Plans & offers isn't empty in the demo.
  const offers: [string, string, string, number, number, number | null, number][] = [
    ["DIWALI26", "Festive offer on Quarterly and above", "PERCENT", 15, 39, 100, 0],
    ["FRIEND500", "Referral: ₹500 off for the new member", "FLAT", 50000, 90, null, 17],
    ["STUDENT10", "Students with valid college ID", "PERCENT", 10, 180, null, 9],
    ["MONSOON25", "Monsoon 2025 promotion", "PERCENT", 25, -32, 60, 41],
  ];
  await db.offer.createMany({
    data: offers.map(([code, description, type, value, days, usageLimit, uses]) => ({
      orgId: org.id, code, description, type, value, validTill: new Date(`${addDays(today, days)}T00:00:00Z`), usageLimit, uses, createdById: users["sumit@demo.fitron.in"]!,
    })),
  });
  console.log(`Seeded the demo gym. Sign in as sumit@demo.fitron.in with password "${DEMO_PASSWORD}".`);
}

const PRODUCTS: [string, string, string, number, number, number | null, number | null][] = [
  ["WHEY-2", "Whey Protein 2 kg", "Supplements", 4200, 3300, 9, 5],
  ["CREA-250", "Creatine 250 g", "Supplements", 1150, 780, 14, 6],
  ["BCAA-300", "BCAA 300 g", "Supplements", 1450, 1020, 3, 4],
  ["TEE", "Power Haus T-shirt", "Apparel", 799, 320, 22, 10],
  ["SHAKER", "Shaker bottle", "Accessories", 450, 160, 31, 10],
  ["STRAPS", "Lifting straps", "Accessories", 549, 210, 2, 5],
  ["WATER-1L", "Mineral water 1 L", "Drinks", 30, 14, 96, 40],
  ["BAR", "Protein bar", "Drinks", 120, 72, 38, 20],
  ["DAYPASS", "Day pass", "Services", 200, 0, null, null],
];
const CLASSES: [string, number, string, number, number][] = [
  ["HIIT", 0, "06:30", 45, 15], ["Strength basics", 0, "18:30", 60, 12], ["Yoga", 1, "07:00", 60, 20], ["Zumba", 1, "18:00", 45, 25],
  ["HIIT", 2, "06:30", 45, 15], ["Functional", 2, "19:00", 50, 14], ["Core & mobility", 3, "07:00", 40, 18], ["Boxing fit", 3, "18:30", 45, 12],
  ["HIIT", 4, "06:30", 45, 15], ["Zumba", 4, "18:00", 45, 25], ["Yoga", 5, "07:00", 60, 20], ["Spin", 6, "08:00", 45, 10],
];
const WORKOUTS = [
  { name: "Beginner full body", goal: "General fitness", level: "Beginner", weeks: 4, days: [{ name: "Day A", exercises: [["Treadmill warm-up", "8 min"], ["Goblet squat", "3 × 12"], ["Lat pulldown", "3 × 12"], ["Dumbbell bench press", "3 × 10"], ["Plank", "3 × 30 s"]] }, { name: "Day B", exercises: [["Cycle warm-up", "8 min"], ["Leg press", "3 × 12"], ["Seated row", "3 × 12"], ["Shoulder press", "3 × 10"], ["Dead bug", "3 × 10"]] }] },
  { name: "Push · Pull · Legs", goal: "Muscle gain", level: "Intermediate", weeks: 8, days: [{ name: "Push", exercises: [["Bench press", "4 × 8"], ["Incline dumbbell press", "3 × 10"], ["Cable fly", "3 × 12"], ["Tricep pushdown", "4 × 12"]] }, { name: "Pull", exercises: [["Deadlift", "4 × 5"], ["Pull-ups", "4 × 8"], ["Barbell row", "3 × 10"], ["Biceps curl", "3 × 12"]] }, { name: "Legs", exercises: [["Back squat", "4 × 6"], ["Romanian deadlift", "3 × 10"], ["Walking lunge", "3 × 12"], ["Calf raise", "4 × 15"]] }] },
  { name: "Fat loss circuit", goal: "Weight loss", level: "Beginner", weeks: 6, days: [{ name: "Circuit 1", exercises: [["Rowing", "5 min"], ["Kettlebell swing", "4 × 15"], ["Box step-up", "4 × 12"], ["Battle ropes", "4 × 30 s"], ["Incline walk", "15 min"]] }, { name: "Circuit 2", exercises: [["Skipping", "5 min"], ["Thrusters", "4 × 12"], ["Mountain climbers", "4 × 30 s"], ["TRX row", "4 × 12"]] }] },
  { name: "Strength 5×5", goal: "Strength", level: "Advanced", weeks: 12, days: [{ name: "Workout A", exercises: [["Squat", "5 × 5"], ["Bench press", "5 × 5"], ["Barbell row", "5 × 5"]] }, { name: "Workout B", exercises: [["Squat", "5 × 5"], ["Overhead press", "5 × 5"], ["Deadlift", "1 × 5"]] }] },
];
const DIETS = [
  { name: "Vegetarian fat loss · 1,600 kcal", kcal: 1600, protein: 95, meals: [["Breakfast", "Besan chilla (2) with mint chutney, black coffee"], ["Mid-morning", "1 apple, 10 almonds"], ["Lunch", "2 multigrain rotis, dal, sabzi, salad, curd"], ["Evening", "Roasted chana, green tea"], ["Dinner", "Paneer bhurji (100 g), 1 roti, sautéed vegetables"]] },
  { name: "High-protein gain · 2,800 kcal", kcal: 2800, protein: 160, meals: [["Breakfast", "4 egg omelette, 3 slices brown bread, banana shake"], ["Mid-morning", "Whey shake, peanut butter toast"], ["Lunch", "Rice, chicken curry (200 g), dal, salad"], ["Evening", "Sprouts chaat, 2 boiled eggs"], ["Dinner", "3 rotis, fish or paneer (200 g), vegetables, curd"]] },
  { name: "Balanced maintenance · 2,100 kcal", kcal: 2100, protein: 110, meals: [["Breakfast", "Poha with peanuts, 2 boiled eggs or tofu"], ["Mid-morning", "Fruit bowl"], ["Lunch", "Rice, rajma, salad, buttermilk"], ["Evening", "Makhana, tea"], ["Dinner", "2 rotis, chicken or soya, mixed vegetables"]] },
];
const LEADS: [string, string, string, string, number][] = [
  ["Arjun Mehta", "9801112201", "Instagram", "New", 0], ["Kavya Rani", "9801112202", "Friend", "Contacted", 1], ["Rakesh Prasad", "9801112203", "Walk-in", "Trial booked", 1],
  ["Simran Kaur", "9801112204", "Google", "Trial done", -1], ["Deepa Soren", "9801112205", "Flyer", "New", -2], ["Mohit Jaiswal", "9801112206", "Instagram", "Contacted", 3],
  ["Tanvi Bose", "9801112207", "Friend", "Lost", 0],
];

/** Products, classes, programs, leads and a fortnight of visits. Runs once per demo gym. */
async function seedFrontDesk(orgId: string) {
  if (await db.product.count({ where: { orgId } })) return false;
  const branches = await db.branch.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  const users = await db.user.findMany({ where: { orgId }, include: { role: true, branches: true } });
  const trainerFor = (branchId: string) => users.find((x) => x.role.name === "Trainer" && x.branches.some((b) => b.branchId === branchId)) ?? users[0]!;
  const desk = users.find((x) => x.role.name === "Receptionist") ?? users[0]!;
  const owner = users.find((x) => x.role.name === "Super Admin") ?? users[0]!;

  for (const b of branches) {
    for (const [sku, name, category, price, cost, stock, reorder] of PRODUCTS) {
      const p = await db.product.create({ data: { orgId, branchId: b.id, sku, name, category, price: price * 100, cost: cost * 100, stock, reorderLevel: reorder } });
      if (stock) await db.stockMovement.create({ data: { productId: p.id, qty: stock, reason: "RESTOCK", unitCost: cost * 100, note: "Opening stock", createdById: owner.id } });
    }
  }
  const main = branches[0]!;
  const t = trainerFor(main.id);
  const slots = [];
  for (const [name, weekday, startTime, durationMin, capacity] of CLASSES) {
    slots.push(await db.classSlot.create({ data: { orgId, branchId: main.id, name, trainerId: t.id, weekday, startTime, durationMin, capacity } }));
  }
  const workouts = [];
  for (const w of WORKOUTS) workouts.push(await db.workoutPlan.create({ data: { orgId, name: w.name, goal: w.goal, level: w.level, weeks: w.weeks, days: w.days.map((d) => ({ name: d.name, exercises: d.exercises.map(([n, s]) => ({ name: n, sets: s })) })) } }));
  const diets = [];
  for (const x of DIETS) diets.push(await db.dietPlan.create({ data: { orgId, name: x.name, kcal: x.kcal, protein: x.protein, meals: x.meals.map(([n, f]) => ({ name: n, food: f })) } }));

  const members = await db.member.findMany({ where: { orgId, deletedAt: null, walkIn: false }, include: { memberships: { where: { status: "VALID" }, orderBy: { endDate: "desc" }, take: 1 } } });
  for (const m of members) {
    if (rnd() < 0.5) await db.member.update({ where: { id: m.id }, data: { workoutPlanId: pick(workouts).id, dietPlanId: rnd() < 0.6 ? pick(diets).id : null } });
  }
  // Two weeks of visits by members whose membership covered the day.
  for (let back = 13; back >= 0; back--) {
    const day = addDays(today, -back);
    for (const m of members) {
      const ms = m.memberships[0];
      if (!ms || ms.startDate > d(day) || ms.endDate < d(day) || rnd() > 0.45) continue;
      const h = ri(6, 20);
      const inAt = new Date(new Date(`${day}T${String(h).padStart(2, "0")}:${String(ri(0, 59)).padStart(2, "0")}:00.000Z`).getTime() - 330 * 60_000);
      const out = back === 0 && rnd() < 0.3 ? null : new Date(inAt.getTime() + ri(45, 110) * 60_000);
      await db.attendance.create({ data: { branchId: m.branchId, memberId: m.id, type: "MEMBER", date: d(day), checkIn: inAt, checkOut: out, method: pick(["Manual", "QR", "QR"]), createdById: desk.id } });
    }
  }
  // This week's and next week's bookings for the main branch.
  const pool = members.filter((m) => m.branchId === main.id && m.memberships[0] && m.memberships[0].endDate >= d(today));
  const weekday = (d(today).getUTCDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  for (const slot of slots) {
    for (const off of [0, 7]) {
      const date = addDays(monday, off + slot.weekday);
      const n = Math.min(pool.length, Math.round(slot.capacity * (0.5 + rnd() * 0.5)) + (rnd() < 0.3 ? 2 : 0));
      const chosen = [...pool].sort(() => rnd() - 0.5).slice(0, n);
      for (let i = 0; i < chosen.length; i++) {
        const past = date < today;
        const status = i >= slot.capacity ? "Waitlist" : past ? (rnd() < 0.86 ? "Attended" : "No-show") : "Booked";
        await db.booking.create({ data: { classSlotId: slot.id, date: d(date), memberId: chosen[i]!.id, status } });
      }
    }
  }
  for (const [name, phone, source, stage, follow] of LEADS) {
    await db.lead.create({
      data: {
        orgId,
        branchId: main.id,
        name,
        phone,
        source,
        interest: pick(["Monthly", "Quarterly", "Personal training", "Yoga classes"]),
        stage,
        followUpOn: stage === "Lost" ? null : d(addDays(today, follow)),
        trialOn: stage === "Trial booked" ? d(addDays(today, 1)) : stage === "Trial done" ? d(addDays(today, -1)) : null,
        ownerId: desk.id,
        lostReason: stage === "Lost" ? "Joined a gym closer to home" : null,
      },
    });
  }
  return true;
}

async function seqNext(orgId: string, name: string, start: number) {
  const rows = await db.$queryRaw<{ next: number }[]>`
    INSERT INTO "Sequence" ("orgId", "name", "next") VALUES (${orgId}, ${name}, ${start + 1})
    ON CONFLICT ("orgId", "name") DO UPDATE SET "next" = "Sequence"."next" + 1
    RETURNING "next" - 1 AS "next"`;
  return Number(rows[0]!.next);
}

const ASSETS: [string, string, number, number, number, "WDV" | "SLM", number, string | null][] = [
  // name, category, qty, months ago, cost (₹), method, rate % or life years, paid by (null = before Fitron)
  ["Commercial treadmill", "Cardio equipment", 4, 14, 480000, "WDV", 15, "Bank Transfer"],
  ["Power rack with bench", "Strength equipment", 2, 14, 180000, "WDV", 15, "Bank Transfer"],
  ["Dumbbell set 2.5–40 kg", "Free weights", 1, 13, 95000, "WDV", 15, "UPI"],
  ["Split AC 2 ton", "Air conditioning", 3, 20, 135000, "WDV", 15, null],
  ["Front desk PC and printer", "Electronics & computers", 1, 5, 62000, "SLM", 3, "Card"],
  ["Reception furniture", "Furniture & fixtures", 1, 26, 70000, "WDV", 10, null],
];

/** A small asset register and two supplier bills. Runs once per demo gym. */
async function seedAssets(orgId: string) {
  if (await db.asset.count({ where: { orgId } })) return false;
  const main = (await db.branch.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" } }))!;
  const owner = (await db.user.findFirst({ where: { orgId, role: { name: "Super Admin" } } }))!;
  const expense = async (date: string, categoryId: string, description: string, vendor: string, amount: number, method: string, extra: object = {}) =>
    db.expense.create({ data: { code: `EXP-${await seqNext(orgId, "expense", 1)}`, orgId, branchId: main.id, date: d(date), categoryId, description, vendor, amount, method, createdById: owner.id, ...extra } });

  for (const [name, category, qty, ago, cost, method, x, paidBy] of ASSETS) {
    const date = addMonths(today, -ago).slice(0, 8) + "10";
    const a = await db.asset.create({
      data: { orgId, branchId: main.id, code: `AST-${await seqNext(orgId, "asset", 1001)}`, name, category, qty, vendor: pick(["Cybex India", "Croma", "Fitness World Ranchi", "Decathlon"]), purchaseDate: d(date), cost: cost * 100, method, rate: method === "WDV" ? x : null, life: method === "SLM" ? x : null, payMethod: paidBy, createdById: owner.id },
    });
    if (paidBy) {
      const e = await expense(date, "equipment-purchase", `Capital purchase · ${name}${qty > 1 ? ` ×${qty}` : ""}`, a.vendor!, a.cost, paidBy, { capital: true, assetId: a.id, notes: `Capitalised as ${a.code}` });
      await db.asset.update({ where: { id: a.id }, data: { expenseId: e.id } });
    }
  }

  // A settled stock bill last month, and one this month with a balance still owed.
  const products = await db.product.findMany({ where: { branchId: main.id, sku: { in: ["WHEY-2", "CREA-250", "SHAKER"] } } });
  const bills: [number, string, string, number][] = [[35, "Nutri Hub Ranchi", "NH/2291", 1], [9, "Nutri Hub Ranchi", "NH/2378", 0.4]];
  for (const [ago, vendor, billNo, paidShare] of bills) {
    const date = addDays(today, -ago);
    const lines = products.map((p) => ({ p, qty: p.sku === "SHAKER" ? 20 : 6, rate: Math.round(p.cost / 1.18 / 100) * 100 }));
    const total = lines.reduce((s, l) => s + Math.round(l.qty * Math.round(l.rate) * 1.18), 0);
    const paid = paidShare >= 1 ? total : Math.round((total * paidShare) / 100) * 100;
    const method = paid >= total ? "Bank Transfer" : "Credit";
    const pur = await db.purchase.create({ data: { orgId, branchId: main.id, code: `PUR-${await seqNext(orgId, "purchase", 1001)}`, date: d(date), vendor, billNo, total, createdById: owner.id } });
    for (const l of lines) {
      const rate = Math.round(l.rate);
      const amount = Math.round(l.qty * rate * 1.18);
      const e = await expense(date, "inventory", `Purchase · ${l.p.name} × ${l.qty}`, vendor, amount, method, { purchaseId: pur.id, notes: pur.code, billNo });
      await db.product.update({ where: { id: l.p.id }, data: { stock: { increment: l.qty } } });
      await db.stockMovement.create({ data: { productId: l.p.id, qty: l.qty, reason: "RESTOCK", unitCost: Math.round(amount / l.qty), note: `${pur.code} · ${vendor}`, expenseId: e.id, createdById: owner.id } });
      await db.purchaseLine.create({ data: { purchaseId: pur.id, type: "STOCK", description: l.p.name, productId: l.p.id, expenseId: e.id, qty: l.qty, rate, gstPct: 18, amount } });
    }
    if (paid > 0) await db.vendorPayment.create({ data: { purchaseId: pur.id, code: `VP-${await seqNext(orgId, "vendorPayment", 1001)}`, date: d(date), amount: paid, method: "Bank Transfer", createdById: owner.id } });
  }
  return true;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

const UPI_HANDLES = ["okicici", "okhdfcbank", "oksbi", "ybl", "paytm"];

/** Demo UPI autopay mandates on members whose membership is running: mostly active, two paused, one failed. Runs once per demo gym. */
async function seedAutopay(orgId: string) {
  if (await db.autopayMandate.count({ where: { orgId } })) return false;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const owner = await db.user.findFirstOrThrow({ where: { orgId, role: { name: "Super Admin" } } });
  const ms = await db.membership.findMany({
    where: { member: { orgId, walkIn: false, suspended: false, deletedAt: null }, status: "VALID", endDate: { gte: new Date(`${today}T00:00:00Z`) } },
    orderBy: { endDate: "asc" },
    include: { member: true, plan: true },
  });
  const seen = new Set<string>();
  const picks = ms.filter((m) => m.plan.months <= 3 && !seen.has(m.memberId) && seen.add(m.memberId)).slice(0, 12);
  for (const [i, m] of picks.entries()) {
    const n = await seqNext(orgId, "mandate", 1001);
    const end = m.endDate.toISOString().slice(0, 10);
    const next = new Date(`${end}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const status = i === 0 ? "Failed" : i === 2 || i === 8 ? "Paused" : "Active";
    const started = new Date(m.startDate);
    await db.autopayMandate.create({
      data: {
        orgId,
        branchId: m.branchId,
        memberId: m.memberId,
        planId: m.planId,
        code: `MD-${n}`,
        amount: Math.round((m.plan.price - m.plan.discount) * 1.18),
        months: m.plan.months,
        mode: "demo",
        vpa: `${m.member.name.split(" ")[0]!.toLowerCase()}@${UPI_HANDLES[i % UPI_HANDLES.length]}`,
        status,
        nextDebitOn: next,
        retries: status === "Failed" ? 1 : 0,
        lastResult: status === "Failed" ? "Bank did not respond · retry 1 of 3" : `Approved ${started.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`,
        createdById: owner.id,
        createdAt: started,
      },
    });
  }
  return picks.length > 0;
}

/** Monthly running costs per branch: [category, description, vendor, method, ₹ at City Centre, day of month]. */
const RUNNING: [string, string, string, string, number, number][] = [
  ["Rent", "Premises rent", "Landlord", "Bank Transfer", 9000, 5],
  ["Electricity", "Electricity bill", "JBVNL", "UPI", 2500, 12],
  ["Internet", "Broadband", "Airtel", "UPI", 1180, 8],
  ["Trainer Salary", "Trainer salaries", "Payroll", "Bank Transfer", 7000, 1],
  ["Staff Salary", "Front desk and housekeeping salaries", "Payroll", "Bank Transfer", 4000, 1],
  ["Cleaning", "Cleaning supplies", "Local store", "Cash", 600, 18],
  ["Software", "Fitron subscription", "Fitron", "UPI", 1499, 2],
];

/** A year of rent, salaries and bills so Expenses, P&L and the dashboard have history. Runs once per demo gym. */
async function seedRunningCosts(orgId: string) {
  if (await db.expense.count({ where: { orgId, category: { name: "Rent" } } })) return false;
  // Cash and bank on the day the gym's books start, so the cash book and month-end show real balances.
  const opening = { cash: 4000000, bank: 150000000, asOf: "2024-04-01" };
  await db.setting.upsert({ where: { orgId_key: { orgId, key: "opening" } }, create: { orgId, key: "opening", value: opening }, update: {} });
  const branches = await db.branch.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  const owner = await db.user.findFirstOrThrow({ where: { orgId, role: { name: "Super Admin" } } });
  const cats = new Map((await db.expenseCategory.findMany()).map((c) => [c.name, c.id]));
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  let rnd = 7;
  const jitter = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280) * 0.3 + 0.85;
  for (let back = 11; back >= 0; back--) {
    for (const [bi, b] of branches.entries()) {
      for (const [cat, desc, vendor, method, rupees, day] of RUNNING) {
        if (cat === "Software" && bi > 0) continue;
        const date = new Date(Date.UTC(y, m - back, day));
        if (date.toISOString().slice(0, 10) > today) continue;
        const base = bi === 0 ? rupees : Math.round(rupees * 0.6);
        const amount = (["Electricity", "Cleaning"].includes(cat) ? Math.round(base * jitter()) : base) * 100;
        const n = await seqNext(orgId, "expense", 1);
        await db.expense.create({ data: { orgId, branchId: b.id, code: `EXP-${n}`, date, categoryId: cats.get(cat)!, description: desc, vendor, amount, method, createdById: owner.id } });
      }
    }
  }
  return true;
}
