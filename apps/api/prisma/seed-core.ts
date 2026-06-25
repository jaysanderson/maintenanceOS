import type { PrismaClient } from "@prisma/client";
import { calcQuoteTotals, calcInvoiceTotals } from "../src/lib/costing.js";
import { hashPassword } from "../src/lib/auth.js";

// Demo login accounts created on every seed/reset (password: "demo1234").
const DEMO_USERS: { email: string; name: string; role: string }[] = [
  { email: "admin@maintenanceos.com.au", name: "Alex Admin", role: "ADMIN" },
  { email: "manager@maintenanceos.com.au", name: "Morgan Manager", role: "MANAGER" },
  { email: "supervisor@maintenanceos.com.au", name: "Sam Supervisor", role: "SUPERVISOR" },
  { email: "dispatch@maintenanceos.com.au", name: "Dana Dispatcher", role: "DISPATCHER" },
  { email: "tech@maintenanceos.com.au", name: "Taylor Technician", role: "TECHNICIAN" },
];
export const DEMO_PASSWORD = "demo1234";

// --- deterministic pseudo-random so seeds are reproducible ---
let _s = 42;
const rnd = () => {
  _s = (_s * 1664525 + 1013904223) % 4294967296;
  return _s / 4294967296;
};
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) =>
  Math.floor(rnd() * (max - min + 1)) + min;
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);
const pad = (n: number) => String(n).padStart(4, "0");
const year = new Date().getFullYear();

export async function seedDatabase(prisma: PrismaClient) {
  console.log("Clearing existing data…");
  await prisma.stockMovement.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.recurringPlan.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.emailOutbox.deleteMany();
  await prisma.supplierBillLine.deleteMany();
  await prisma.supplierBill.deleteMany();
  await prisma.purchaseOrderLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.workOrderRequiredSkill.deleteMany();
  await prisma.workOrder.deleteMany();
  await prisma.employeeSkill.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.site.deleteMany();
  await prisma.account.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.inventoryLocation.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.appSetting.deleteMany();

  // --- Login users ---
  const pwHash = await hashPassword(DEMO_PASSWORD);
  for (const u of DEMO_USERS) {
    await prisma.user.create({
      data: { email: u.email, name: u.name, role: u.role, passwordHash: pwHash },
    });
  }
  console.log(`Users: ${DEMO_USERS.length}`);

  // --- Skills ---
  const skillNames: [string, string][] = [
    ["Carpentry", "TRADE"], ["Painting", "TRADE"], ["Gutter work", "TRADE"],
    ["Basic plumbing", "TRADE"], ["Lawn care", "TRADE"], ["Pressure washing", "TRADE"],
    ["Working at heights", "COMPLIANCE"], ["White card", "COMPLIANCE"],
    ["Police check", "COMPLIANCE"], ["Aged-care clearance", "COMPLIANCE"],
    ["Electrical subcontractor", "LICENCE"], ["Plumbing subcontractor", "LICENCE"],
    ["Tiling", "TRADE"], ["Glazing", "TRADE"], ["Locksmithing", "TRADE"],
    ["Roof repair", "TRADE"], ["Fencing", "TRADE"], ["Flatpack assembly", "TRADE"],
    ["First aid", "COMPLIANCE"], ["Asbestos awareness", "COMPLIANCE"],
  ];
  const skills = [];
  for (const [name, category] of skillNames) {
    skills.push(await prisma.skill.create({ data: { name, category } }));
  }
  console.log(`Skills: ${skills.length}`);

  // --- Accounts ---
  const accountSeed: { name: string; type: string; mgr: string }[] = [
    { name: "Bendigo Regional Real Estate", type: "REAL_ESTATE", mgr: "Priya Nair" },
    { name: "City of Greater Bendigo", type: "COUNCIL", mgr: "Tom Whitfield" },
    { name: "Castlemaine Secondary College", type: "SCHOOL", mgr: "Priya Nair" },
    { name: "Eaglehawk Aged Care", type: "AGED_CARE", mgr: "Sarah Donnelly" },
    { name: "Ballarat Property Group", type: "REAL_ESTATE", mgr: "Tom Whitfield" },
    { name: "Lakeside Body Corporate", type: "BODY_CORPORATE", mgr: "Sarah Donnelly" },
    { name: "Geelong Grammar Facilities", type: "SCHOOL", mgr: "Priya Nair" },
    { name: "Macedon Ranges Shire", type: "COUNCIL", mgr: "Tom Whitfield" },
    { name: "Harcourt Orchards Pty Ltd", type: "COMMERCIAL", mgr: "Sarah Donnelly" },
    { name: "The Bennett Family", type: "HOMEOWNER", mgr: "Priya Nair" },
    { name: "Sunraysia Retirement Living", type: "AGED_CARE", mgr: "Sarah Donnelly" },
    { name: "Spring Gully Shopping Centre", type: "COMMERCIAL", mgr: "Tom Whitfield" },
  ];
  const accounts = [];
  for (const a of accountSeed) {
    accounts.push(
      await prisma.account.create({
        data: {
          name: a.name,
          type: a.type,
          primaryContactName: pick(["Janet Cole", "Mark Reed", "Lucy Tran", "David Ng", "Karen Field"]),
          email: `accounts@${a.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14)}.com.au`,
          phone: `03 5${int(100, 999)} ${int(1000, 9999)}`,
          billingAddress: `${int(1, 250)} ${pick(["High", "View", "Mitchell", "Hargreaves", "Williamson"])} St`,
          accountManager: a.mgr,
          paymentTerms: pick(["NET_14", "NET_30", "NET_30", "NET_60"]),
          notes: a.type === "AGED_CARE" ? "Police check + aged-care clearance required for all techs." : null,
        },
      })
    );
  }
  console.log(`Accounts: ${accounts.length}`);

  // --- Sites (25) ---
  const suburbs: [string, string, string][] = [
    ["Bendigo", "VIC", "3550"], ["Castlemaine", "VIC", "3450"],
    ["Ballarat", "VIC", "3350"], ["Geelong", "VIC", "3220"],
    ["Eaglehawk", "VIC", "3556"], ["Kangaroo Flat", "VIC", "3555"],
    ["Strathdale", "VIC", "3550"], ["Gisborne", "VIC", "3437"],
    ["Melbourne", "VIC", "3000"], ["Harcourt", "VIC", "3453"],
  ];
  const sites = [];
  for (let i = 0; i < 25; i++) {
    const acc = pick(accounts);
    const [suburb, state, postcode] = pick(suburbs);
    sites.push(
      await prisma.site.create({
        data: {
          accountId: acc.id,
          name: pick(["Main Building", "Block A", "North Wing", "Depot", "Unit Complex", "Admin Office", "Sports Pavilion", "Residential Tower"]) + ` ${i + 1}`,
          address: `${int(1, 400)} ${pick(["High", "Forest", "Lansell", "Napier", "Pall Mall", "View"])} St`,
          suburb, state, postcode,
          accessNotes: pick(["Key safe code on file", "Report to front office", "After-hours access via rear gate", "Contact site manager 30 min prior", null as unknown as string]),
          siteContactName: pick(["Greg Mason", "Alice Bourke", "Sam Patel", "Nina Floros"]),
          siteContactPhone: `04${int(10, 99)} ${int(100, 999)} ${int(100, 999)}`,
          petsOnSite: rnd() < 0.2,
          preferredVisitWindow: pick(["08:00-12:00", "12:00-16:00", "Weekdays only", "School holidays only"]),
        },
      })
    );
  }
  console.log(`Sites: ${sites.length}`);

  // --- Employees (55) ---
  const first = ["James", "Olivia", "Liam", "Charlotte", "Noah", "Amelia", "Jack", "Mia", "Lucas", "Ava", "Ethan", "Ruby", "Mason", "Grace", "Cooper", "Chloe", "Riley", "Zoe", "Hunter", "Ella", "Darren", "Sophie", "Brett", "Hannah", "Wayne", "Tara", "Glen", "Bianca"];
  const last = ["Nguyen", "Smith", "Brown", "Wilson", "Taylor", "Lee", "Walker", "Harris", "Clark", "Robinson", "Edwards", "Murphy", "Cooper", "Bailey", "Reed", "Cox", "Ward", "Foster", "Hughes", "Bishop"];
  const roles = ["TECHNICIAN", "TECHNICIAN", "TECHNICIAN", "TECHNICIAN", "SENIOR_TECHNICIAN", "DISPATCHER", "SUPERVISOR", "ADMIN", "MANAGER"];
  const empTypes = ["FULL_TIME", "FULL_TIME", "PART_TIME", "CASUAL", "SUBCONTRACTOR"];
  const territories = ["Bendigo", "Ballarat", "Geelong", "Macedon", "Melbourne North"];
  const employees = [];
  for (let i = 0; i < 55; i++) {
    const role = i < 38 ? "TECHNICIAN" : pick(roles);
    const fn = pick(first);
    const ln = pick(last);
    employees.push(
      await prisma.employee.create({
        data: {
          firstName: fn,
          lastName: ln,
          role,
          email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@maintenanceos.com.au`,
          phone: `04${int(10, 99)} ${int(100, 999)} ${int(100, 999)}`,
          hourlyCost:
            role === "SENIOR_TECHNICIAN" ? int(55, 70) :
            role === "SUPERVISOR" ? int(60, 80) :
            role === "TECHNICIAN" ? int(38, 52) : int(45, 65),
          employmentType: pick(empTypes),
          territory: pick(territories),
          active: rnd() < 0.92,
        },
      })
    );
  }
  console.log(`Employees: ${employees.length}`);

  // --- Employee skills ---
  let empSkillCount = 0;
  for (const e of employees) {
    const n = int(2, 6);
    const chosen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const s = pick(skills);
      if (chosen.has(s.id)) continue;
      chosen.add(s.id);
      await prisma.employeeSkill.create({ data: { employeeId: e.id, skillId: s.id } });
      empSkillCount++;
    }
  }
  console.log(`Employee skills: ${empSkillCount}`);

  const technicians = employees.filter(
    (e) => e.active && (e.role === "TECHNICIAN" || e.role === "SENIOR_TECHNICIAN")
  );

  // --- Inventory locations (8) ---
  const locations = [];
  locations.push(await prisma.inventoryLocation.create({ data: { name: "Bendigo Main Warehouse", type: "WAREHOUSE" } }));
  locations.push(await prisma.inventoryLocation.create({ data: { name: "Ballarat Sub-Store", type: "WAREHOUSE" } }));
  for (let i = 1; i <= 4; i++)
    locations.push(await prisma.inventoryLocation.create({ data: { name: `Van ${i}`, type: "VAN" } }));
  locations.push(await prisma.inventoryLocation.create({ data: { name: "Trailer 1", type: "TRAILER" } }));
  locations.push(await prisma.inventoryLocation.create({ data: { name: "Damaged / Quarantine", type: "DAMAGED" } }));
  const warehouse = locations[0];
  console.log(`Locations: ${locations.length}`);

  // --- Inventory items (30) ---
  const itemSeed: [string, string, string, number, number][] = [
    ["Tap washer kit", "Plumbing", "EA", 4, 12], ["Flexible hose 600mm", "Plumbing", "EA", 9, 24],
    ["Internal door handle", "Hardware", "EA", 18, 45], ["Flyscreen mesh roll", "Hardware", "M", 6, 15],
    ["Gap filler 450g", "Consumables", "EA", 7, 16], ["Interior paint 4L white", "Paint", "EA", 38, 75],
    ["Exterior paint 4L", "Paint", "EA", 52, 95], ["Paint roller set", "Paint", "EA", 12, 28],
    ["Sandpaper pack", "Consumables", "PK", 8, 18], ["Timber screws 8g box", "Fixings", "BOX", 14, 30],
    ["Dynabolts M10", "Fixings", "BOX", 22, 48], ["Silicone sealant", "Consumables", "EA", 9, 19],
    ["Door closer", "Hardware", "EA", 34, 72], ["Deadlock", "Hardware", "EA", 45, 99],
    ["Gutter bracket", "Roofing", "EA", 5, 13], ["Gutter guard 6m", "Roofing", "EA", 28, 60],
    ["Fence palings", "Timber", "EA", 6, 14], ["Treated pine post", "Timber", "EA", 19, 42],
    ["Shelf bracket pair", "Hardware", "PR", 11, 25], ["Cable ties 200pk", "Consumables", "PK", 7, 16],
    ["LED downlight", "Electrical", "EA", 16, 38], ["Power point double", "Electrical", "EA", 13, 30],
    ["PVC pipe 1m", "Plumbing", "EA", 8, 18], ["Pipe clamp set", "Plumbing", "PK", 6, 15],
    ["Hinge heavy duty", "Hardware", "EA", 9, 21], ["Weather strip 5m", "Hardware", "EA", 12, 26],
    ["Concrete mix 20kg", "Building", "BAG", 11, 22], ["Grout 5kg", "Building", "BAG", 17, 34],
    ["Smoke alarm 10yr", "Safety", "EA", 24, 49], ["Pressure washer nozzle", "Equipment", "EA", 21, 44],
  ];
  const items = [];
  for (let i = 0; i < itemSeed.length; i++) {
    const [name, category, unit, unitCost, sellPrice] = itemSeed[i];
    items.push(
      await prisma.inventoryItem.create({
        data: {
          sku: `SKU-${pad(i + 1)}`,
          name, category, unit, unitCost, sellPrice,
          reorderPoint: int(5, 20),
          active: true,
        },
      })
    );
  }
  console.log(`Inventory items: ${items.length}`);

  // --- Stock movements: receipt into warehouse, some transfers to vans ---
  let moveCount = 0;
  for (const item of items) {
    await prisma.stockMovement.create({
      data: {
        inventoryItemId: item.id,
        toLocationId: warehouse.id,
        quantity: int(20, 80),
        movementType: "PURCHASE_RECEIPT",
        notes: "Opening stock",
      },
    });
    moveCount++;
    if (rnd() < 0.6) {
      const van = pick(locations.filter((l) => l.type === "VAN"));
      await prisma.stockMovement.create({
        data: {
          inventoryItemId: item.id,
          fromLocationId: warehouse.id,
          toLocationId: van.id,
          quantity: int(2, 10),
          movementType: "TRANSFER",
          notes: "Van restock",
        },
      });
      moveCount++;
    }
  }

  // --- Suppliers (8) ---
  const supplierNames = ["Bendigo Trade Supplies", "Reece Plumbing", "Bunnings Trade", "Dulux Trade Centre", "Bowens Timber", "Total Tools Bendigo", "Electrical Wholesale Co", "Safety First Australia"];
  const suppliers = [];
  for (const name of supplierNames) {
    suppliers.push(
      await prisma.supplier.create({
        data: {
          name,
          contactName: pick(["Rob Hayes", "Tina Walsh", "Mike O'Brien", "Sandra Pell"]),
          email: `sales@${name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 12)}.com.au`,
          phone: `03 5${int(100, 999)} ${int(1000, 9999)}`,
          address: `${int(1, 200)} ${pick(["Midland Hwy", "Industrial Dr", "Strickland Rd"])}, Bendigo VIC 3550`,
          paymentTerms: pick(["NET_30", "NET_14", "COD"]),
        },
      })
    );
  }
  console.log(`Suppliers: ${suppliers.length}`);

  // --- Purchase Orders (10) ---
  const itemName = new Map(items.map((it) => [it.id, it.name]));
  const createdPOs: {
    id: string;
    supplierId: string;
    lines: { inventoryItemId: string; name: string; quantity: number; unitCost: number; total: number }[];
  }[] = [];
  for (let i = 0; i < 10; i++) {
    const sup = pick(suppliers);
    const lineCount = int(2, 5);
    const lines = [];
    for (let l = 0; l < lineCount; l++) {
      const it = pick(items);
      const qty = int(5, 30);
      lines.push({
        inventoryItemId: it.id,
        quantity: qty,
        unitCost: it.unitCost,
        total: Math.round(qty * it.unitCost * 100) / 100,
      });
    }
    const status = pick(["DRAFT", "SENT", "SENT", "PART_RECEIVED", "RECEIVED", "RECEIVED"]);
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-${year}-${pad(i + 1)}`,
        supplierId: sup.id,
        status,
        expectedDate: daysFromNow(int(-10, 21)),
        lines: { create: lines },
      },
      include: { lines: true },
    });
    createdPOs.push({
      id: po.id,
      supplierId: sup.id,
      lines: lines.map((l) => ({ ...l, name: itemName.get(l.inventoryItemId) ?? "Item" })),
    });
    if (status === "RECEIVED" || status === "PART_RECEIVED") {
      for (const line of po.lines) {
        const recvQty = status === "RECEIVED" ? line.quantity : Math.floor(line.quantity / 2);
        await prisma.stockMovement.create({
          data: {
            inventoryItemId: line.inventoryItemId,
            toLocationId: warehouse.id,
            quantity: recvQty,
            movementType: "PURCHASE_RECEIPT",
            notes: `Received against ${po.poNumber}`,
          },
        });
        await prisma.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQty: recvQty },
        });
        moveCount++;
      }
    }
  }
  console.log(`Purchase orders: 10`);

  // --- Supplier Bills / AP (7) ---
  // Bills RECEIVED from suppliers (money we owe). Some are matched to a
  // catalogue item, some are pure service/freight charges. A couple are past
  // due to demo the overdue styling and the dunning-free AP view.
  const billStatuses = ["DRAFT", "APPROVED", "APPROVED", "PAID", "PAID", "DISPUTED"];
  for (let i = 0; i < 7; i++) {
    // Bills 0 & 1 are deliberately PO-linked (0 matches cleanly, 1 is over-billed
    // to demo a 3-way-match exception); the rest are ~60% linked, else standalone.
    const forceLink = i <= 1 && createdPOs.length > 0;
    const linkedPo = forceLink
      ? pick(createdPOs)
      : createdPOs.length > 0 && rnd() < 0.6
        ? pick(createdPOs)
        : null;
    const sup = linkedPo
      ? suppliers.find((s) => s.id === linkedPo.supplierId) ?? pick(suppliers)
      : pick(suppliers);
    type BillLine = { inventoryItemId: string | null; description: string; quantity: number; unitCost: number; total: number };
    const billLines: BillLine[] = [];
    if (linkedPo) {
      // Mirror the PO lines so the bill's ex-tax subtotal == the PO total (a clean 3-way match).
      for (const l of linkedPo.lines) {
        billLines.push({ inventoryItemId: l.inventoryItemId, description: l.name, quantity: l.quantity, unitCost: l.unitCost, total: l.total });
      }
      // Bill 1: add an unapproved surcharge that pushes it over tolerance.
      if (i === 1) {
        billLines.push({ inventoryItemId: null, description: "Unapproved delivery surcharge", quantity: 1, unitCost: 280, total: 280 });
      }
    } else {
      const lineCount = int(2, 4);
      for (let l = 0; l < lineCount; l++) {
        if (rnd() < 0.25) {
          const qty = 1;
          const unitCost = int(35, 180);
          billLines.push({ inventoryItemId: null, description: pick(["Freight & handling", "Call-out fee", "Disposal levy", "Restocking charge"]), quantity: qty, unitCost, total: Math.round(qty * unitCost * 100) / 100 });
        } else {
          const it = pick(items);
          const qty = int(3, 24);
          billLines.push({ inventoryItemId: it.id, description: it.name, quantity: qty, unitCost: it.unitCost, total: Math.round(qty * it.unitCost * 100) / 100 });
        }
      }
    }
    const subtotal = Math.round(billLines.reduce((s, l) => s + l.total, 0) * 100) / 100;
    const tax = Math.round(subtotal * 0.1 * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    const status = billStatuses[i % billStatuses.length];
    const issued = daysFromNow(int(-45, -3));
    await prisma.supplierBill.create({
      data: {
        billNumber: `BILL-${year}-${pad(i + 1)}`,
        supplierRef: `INV-${int(10000, 99999)}`,
        supplierId: sup.id,
        purchaseOrderId: linkedPo?.id ?? null,
        status,
        issueDate: issued,
        dueDate: daysFromNow(int(-12, 24)),
        subtotal,
        tax,
        total,
        lines: { create: billLines },
      },
    });
  }
  console.log(`Supplier bills: 7`);

  // --- Work Orders (120) ---
  const jobTitles = [
    "Repair leaking tap", "Replace damaged door handle", "Patch and paint wall damage",
    "Clean gutters", "Pressure wash courtyard", "Repair fence panel", "Replace flyscreen",
    "Assemble storage shelving", "Fix sticking internal door", "Emergency make-safe after storm damage",
    "Quarterly rental property maintenance", "School facilities maintenance inspection",
    "Replace broken window pane", "Re-key external locks", "Service roller door",
  ];
  // Job-specific detail per title so the knowledge base has real, varied
  // content to ground AI answers/playbooks (not a single placeholder).
  const JOB_DETAILS: Record<string, { description: string; completion: string }> = {
    "Repair leaking tap": {
      description:
        "Kitchen mixer tap dripping from the spout and base. Likely a perished washer or worn ceramic cartridge. Isolate water at the stop valve, replace the tap washer / mixer cartridge, reseat and test under pressure for leaks.",
      completion:
        "Isolated supply, replaced the mixer cartridge and inlet washers, resealed the base, tested hot and cold under pressure — no leaks. Materials: mixer cartridge, washers, plumber's tape.",
    },
    "Replace damaged door handle": {
      description:
        "Internal door lever handle loose and not latching. Replace the handle set and strike plate, align the latch, check operation.",
      completion:
        "Fitted new lever handle set and strike plate, realigned latch, lubricated mechanism — operates smoothly. Materials: handle set, screws.",
    },
    "Patch and paint wall damage": {
      description:
        "Plasterboard damage to internal wall (knock/impact). Cut back, patch with plasterboard/compound, sand, prime and repaint to match existing colour.",
      completion:
        "Patched plasterboard, sanded, primed and repainted two coats to match. Materials: plasterboard offcut, jointing compound, primer, paint.",
    },
    "Clean gutters": {
      description:
        "Gutters and downpipes blocked with leaf litter on a single-storey dwelling. Clear debris, flush downpipes, check for sagging and corrosion.",
      completion:
        "Cleared all gutters and downpipes, flushed and confirmed free flow, noted no corrosion. Used ladder per safe work method.",
    },
    "Pressure wash courtyard": {
      description:
        "Paved courtyard with moss and grime buildup. Pressure wash pavers and retaining wall, treat slippery areas.",
      completion:
        "Pressure washed pavers and wall, treated mossy sections, area left clean and non-slip.",
    },
    "Repair fence panel": {
      description:
        "Timber/colorbond fence panel damaged and leaning after wind. Re-secure or replace the panel and repair the post fixing.",
      completion:
        "Replaced the damaged panel, re-fixed the post bracket, checked line and tension. Materials: fence panel, post bracket, fasteners.",
    },
    "Replace flyscreen": {
      description:
        "Window flyscreen torn. Re-mesh or replace the screen frame to suit the window opening.",
      completion:
        "Re-meshed the flyscreen frame and refitted to the window — secure and flush. Materials: fibreglass mesh, spline.",
    },
    "Assemble storage shelving": {
      description:
        "Flat-pack storage shelving to assemble and anchor in a store room. Assemble per instructions and wall-anchor to prevent tip-over.",
      completion:
        "Assembled shelving units and anchored to wall studs per tip-over guidance. Materials: shelving kit, wall anchors.",
    },
    "Fix sticking internal door": {
      description:
        "Internal door binding against the frame, likely seasonal swelling or dropped hinge. Adjust hinges or plane the edge and re-finish.",
      completion:
        "Adjusted hinges and eased the binding edge, sealed bare timber — door swings freely.",
    },
    "Emergency make-safe after storm damage": {
      description:
        "Storm damage — water ingress and loose roofing/cladding presenting a hazard. Attend urgently, make the area safe, tarp/secure, document for insurance and follow-up works.",
      completion:
        "Made site safe, secured loose cladding, installed temporary tarp to stop water ingress, photographed damage for the claim. Follow-up repair quoted separately.",
    },
    "Quarterly rental property maintenance": {
      description:
        "Scheduled quarterly maintenance check across a rental property — smoke alarms, taps/seals, door hardware, minor repairs and a condition report.",
      completion:
        "Completed quarterly checks: tested smoke alarms, checked tap seals and door hardware, actioned minor repairs, condition report filed.",
    },
    "School facilities maintenance inspection": {
      description:
        "Routine facilities inspection across school buildings — playground hardware, fencing, doors, wet areas, safety items. Log defects and recommend remedial works.",
      completion:
        "Inspected facilities, logged defects (fencing, two door closers), recommended remedial works with priorities. Report issued.",
    },
    "Replace broken window pane": {
      description:
        "Cracked/broken window pane presenting a safety risk. Remove broken glass safely, measure and install replacement glazing, reseal.",
      completion:
        "Removed broken glazing safely, installed replacement pane, resealed and cleaned. Materials: glass pane, glazing seal.",
    },
    "Re-key external locks": {
      description:
        "External door locks to be re-keyed after tenancy change. Re-pin or replace cylinders, supply new keys, test all entry points.",
      completion:
        "Re-keyed external cylinders, tested all entry doors, supplied three keys per door to the property manager. Materials: pinning kit, blank keys.",
    },
    "Service roller door": {
      description:
        "Roller/garage door noisy and slow. Service the motor and tracks, lubricate, adjust tension and limits, test safety reverse.",
      completion:
        "Serviced roller door — lubricated tracks, adjusted spring tension and travel limits, tested auto-reverse. Operates quietly.",
    },
  };
  const jobTypes = ["REPAIR", "MAINTENANCE", "INSPECTION", "EMERGENCY", "QUOTE_ONLY", "RECURRING_SERVICE"];
  const priorities = ["LOW", "NORMAL", "NORMAL", "NORMAL", "HIGH", "URGENT"];
  const statuses = [
    "NEW", "TRIAGE", "QUOTE_REQUIRED", "AWAITING_APPROVAL", "APPROVED",
    "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "WAITING_ON_PARTS",
    "COMPLETED", "INVOICED", "CLOSED", "CANCELLED",
  ];

  const workOrders = [];
  for (let i = 0; i < 120; i++) {
    const site = pick(sites);
    const status = i < 30 ? pick(["NEW", "TRIAGE", "QUOTE_REQUIRED"])
      : i < 55 ? pick(["AWAITING_APPROVAL", "APPROVED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "WAITING_ON_PARTS"])
      : pick(["COMPLETED", "INVOICED", "CLOSED", "CANCELLED"]);
    const assigned =
      ["NEW", "TRIAGE", "QUOTE_REQUIRED"].includes(status) && rnd() < 0.7
        ? null
        : pick(technicians);
    const estimatedHours = int(1, 8) + (rnd() < 0.5 ? 0.5 : 0);
    const isDone = ["COMPLETED", "INVOICED", "CLOSED"].includes(status);
    const priority = pick(priorities);
    const slaOffset =
      priority === "URGENT" ? int(-3, 2) :
      priority === "HIGH" ? int(-5, 6) : int(-8, 20);
    const scheduledStart =
      ["SCHEDULED", "DISPATCHED", "IN_PROGRESS", "COMPLETED", "INVOICED", "CLOSED"].includes(status)
        ? daysFromNow(int(-25, 10))
        : null;
    const woTitle = pick(jobTitles);

    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `WO-${year}-${pad(i + 1)}`,
        accountId: site.accountId,
        siteId: site.id,
        title: woTitle,
        description: JOB_DETAILS[woTitle]?.description ?? "Customer reported issue requiring attention. See site contact for access.",
        jobType: pick(jobTypes),
        priority,
        status,
        assignedEmployeeId: assigned?.id ?? null,
        scheduledStart,
        scheduledEnd: scheduledStart ? new Date(scheduledStart.getTime() + estimatedHours * 3600000) : null,
        slaDueAt: daysFromNow(slaOffset),
        estimatedHours,
        actualHours: isDone ? estimatedHours + (rnd() < 0.4 ? int(1, 3) : 0) : null,
        customerNotes: rnd() < 0.3 ? "Please call before attending." : null,
        internalNotes: rnd() < 0.3 ? "Check van stock before dispatch." : null,
        completionNotes: isDone
          ? JOB_DETAILS[woTitle]?.completion ?? "Work completed and site left clean. Customer notified."
          : null,
      },
    });
    // required skills
    const reqN = int(0, 2);
    const used = new Set<string>();
    for (let r = 0; r < reqN; r++) {
      const s = pick(skills);
      if (used.has(s.id)) continue;
      used.add(s.id);
      await prisma.workOrderRequiredSkill.create({ data: { workOrderId: wo.id, skillId: s.id } });
    }
    // consume stock for done jobs
    if (isDone && rnd() < 0.7) {
      const consumeN = int(1, 3);
      for (let c = 0; c < consumeN; c++) {
        const it = pick(items);
        await prisma.stockMovement.create({
          data: {
            inventoryItemId: it.id,
            fromLocationId: pick(locations.filter((l) => l.type === "VAN")).id,
            workOrderId: wo.id,
            quantity: int(1, 5),
            movementType: "CONSUMED_ON_JOB",
            notes: `Used on ${wo.workOrderNumber}`,
          },
        });
        moveCount++;
      }
    }
    workOrders.push(wo);
  }
  console.log(`Work orders: ${workOrders.length}`);
  console.log(`Stock movements: ${moveCount}`);

  // --- Quotes (20) ---
  const quotableWO = workOrders.filter((w) =>
    ["AWAITING_APPROVAL", "APPROVED", "SCHEDULED", "COMPLETED", "INVOICED", "CLOSED"].includes(w.status)
  );
  const quotes = [];
  for (let i = 0; i < 20 && i < quotableWO.length; i++) {
    const wo = quotableWO[i];
    const input = {
      labourHours: int(2, 10),
      labourRate: int(85, 130),
      materialCost: int(20, 400),
      subcontractorCost: rnd() < 0.3 ? int(150, 600) : 0,
      equipmentCost: rnd() < 0.3 ? int(40, 200) : 0,
      travelCost: int(20, 90),
      disposalCost: rnd() < 0.2 ? int(30, 120) : 0,
      marginPercent: pick([15, 20, 25, 30, 35]),
    };
    const totals = calcQuoteTotals(input);
    const status = ["COMPLETED", "INVOICED", "CLOSED"].includes(wo.status)
      ? "APPROVED"
      : wo.status === "APPROVED" || wo.status === "SCHEDULED"
      ? "APPROVED"
      : pick(["DRAFT", "SENT", "SENT", "APPROVED"]);
    quotes.push(
      await prisma.quote.create({
        data: {
          quoteNumber: `Q-${year}-${pad(i + 1)}`,
          workOrderId: wo.id,
          accountId: wo.accountId,
          status,
          ...input,
          subtotal: totals.subtotal,
          gst: totals.gst,
          total: totals.total,
          validUntil: daysFromNow(30),
          notes: "Quote excludes after-hours surcharge unless stated.",
        },
      })
    );
  }
  console.log(`Quotes: ${quotes.length}`);

  // --- Invoices (35) ---
  const invoiceableWO = workOrders.filter((w) =>
    ["COMPLETED", "INVOICED", "CLOSED"].includes(w.status)
  );
  let invCount = 0;
  for (let i = 0; i < 35 && i < invoiceableWO.length; i++) {
    const wo = invoiceableWO[i];
    const q = quotes.find((qq) => qq.workOrderId === wo.id);
    const base = q ? q.subtotal : int(300, 2500);
    const totals = calcInvoiceTotals(base);
    const issuedAt = daysFromNow(-int(2, 120));
    const dueAt = new Date(issuedAt.getTime() + 30 * 86400000);
    const overdue = dueAt < new Date();
    const status = pick(
      overdue ? ["PAID", "PAID", "OVERDUE", "OVERDUE", "SENT"] : ["PAID", "SENT", "SENT", "DRAFT"]
    );
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${year}-${pad(i + 1)}`,
        workOrderId: wo.id,
        accountId: wo.accountId,
        status,
        subtotal: totals.subtotal,
        gst: totals.gst,
        total: totals.total,
        issuedAt,
        dueAt,
        paidAt: status === "PAID" ? new Date(issuedAt.getTime() + int(5, 40) * 86400000) : null,
        notes: `Generated from ${wo.workOrderNumber}`,
      },
    });
    invCount++;
  }
  console.log(`Invoices: ${invCount}`);

  // --- Vehicles (12) ---
  const vehicles = [];
  const makes: [string, string][] = [["Toyota", "Hilux"], ["Ford", "Ranger"], ["Toyota", "HiAce"], ["Isuzu", "D-Max"], ["Mitsubishi", "Triton"]];
  for (let i = 0; i < 12; i++) {
    const [make, model] = pick(makes);
    vehicles.push(
      await prisma.vehicle.create({
        data: {
          name: `Fleet ${i + 1} - ${make} ${model}`,
          registration: `${int(1, 9)}${pick(["AB", "CD", "EF", "GH"])}${int(100, 999)}`,
          assignedEmployeeId: i < technicians.length ? technicians[i].id : null,
          make, model,
          year: int(2017, 2024),
          odometer: int(20000, 210000),
          serviceDueAt: daysFromNow(int(-20, 90)),
          registrationDueAt: daysFromNow(int(-10, 250)),
          active: true,
        },
      })
    );
  }
  console.log(`Vehicles: ${vehicles.length}`);

  // --- Assets (30) ---
  const assetSeed: [string, string][] = [
    ["Cordless drill kit", "TOOL"], ["Circular saw", "TOOL"], ["Pressure washer", "MACHINE"],
    ["Extension ladder 3.6m", "SAFETY_EQUIPMENT"], ["Site box trailer", "TRAILER"],
    ["Generator 2kVA", "MACHINE"], ["Harness & lanyard set", "SAFETY_EQUIPMENT"],
    ["Tile cutter", "TOOL"], ["Wet/dry vacuum", "MACHINE"], ["Scaffold tower", "SAFETY_EQUIPMENT"],
  ];
  for (let i = 0; i < 30; i++) {
    const [name, assetType] = assetSeed[i % assetSeed.length];
    const status = pick(["AVAILABLE", "ASSIGNED", "ASSIGNED", "UNDER_REPAIR", "RETIRED"]);
    await prisma.asset.create({
      data: {
        name: `${name} #${i + 1}`,
        assetType,
        serialNumber: `SN-${int(10000, 99999)}`,
        assignedEmployeeId:
          status === "ASSIGNED" && technicians.length ? pick(technicians).id : null,
        assignedVehicleId:
          status === "ASSIGNED" && rnd() < 0.5 ? pick(vehicles).id : null,
        status,
        serviceDueAt: assetType === "MACHINE" ? daysFromNow(int(-15, 120)) : null,
      },
    });
  }
  console.log(`Assets: 30`);

  // --- Representative audit history (so the demo Audit Log isn't empty) ---
  const adminU = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  const mgrU = await prisma.user.findFirst({ where: { role: "MANAGER" } });
  const auditWOs = await prisma.workOrder.findMany({
    where: { status: { in: ["COMPLETED", "INVOICED", "SCHEDULED"] } },
    take: 6,
    orderBy: { updatedAt: "desc" },
  });
  const auditQuotes = await prisma.quote.findMany({
    where: { status: "APPROVED" },
    take: 3,
  });
  const auditInvoices = await prisma.invoice.findMany({ take: 3 });
  const aLog: {
    at: Date;
    userId: string | null;
    userEmail: string | null;
    action: string;
    entity: string | null;
    entityId: string | null;
    summary: string;
  }[] = [];
  const who = (u: typeof adminU) =>
    u ? { userId: u.id, userEmail: u.email } : { userId: null, userEmail: null };
  let t = 0;
  const ago = () => new Date(Date.now() - ++t * 3.6e6 - int(0, 3.4e6));
  if (adminU)
    aLog.push({
      at: ago(),
      ...who(adminU),
      action: "LOGIN",
      entity: null,
      entityId: null,
      summary: `${adminU.email} logged in`,
    });
  if (mgrU)
    aLog.push({
      at: ago(),
      ...who(mgrU),
      action: "LOGIN",
      entity: null,
      entityId: null,
      summary: `${mgrU.email} logged in`,
    });
  for (const w of auditWOs)
    aLog.push({
      at: ago(),
      ...who(adminU),
      action: "WORK_ORDER_STATUS",
      entity: "WorkOrder",
      entityId: w.id,
      summary: `${w.workOrderNumber}: status set to ${w.status}`,
    });
  for (const q of auditQuotes)
    aLog.push({
      at: ago(),
      ...who(mgrU ?? adminU),
      action: "QUOTE_APPROVED",
      entity: "Quote",
      entityId: q.id,
      summary: `${q.quoteNumber} approved (${q.total})`,
    });
  for (const inv of auditInvoices)
    aLog.push({
      at: ago(),
      ...who(adminU),
      action: "INVOICE_CREATE",
      entity: "Invoice",
      entityId: inv.id,
      summary: `${inv.invoiceNumber} created (${inv.total})`,
    });
  if (adminU)
    aLog.push({
      at: ago(),
      ...who(adminU),
      action: "SETTINGS_UPDATED",
      entity: "AppSetting",
      entityId: null,
      summary: `${adminU.email} updated company/finance settings`,
    });
  if (aLog.length) await prisma.auditLog.createMany({ data: aLog });
  console.log(`Audit entries: ${aLog.length}`);

  console.log("\nSeed complete.");

  return {
    users: await prisma.user.count(),
    auditEntries: await prisma.auditLog.count(),
    accounts: await prisma.account.count(),
    sites: await prisma.site.count(),
    employees: await prisma.employee.count(),
    workOrders: await prisma.workOrder.count(),
    quotes: await prisma.quote.count(),
    invoices: await prisma.invoice.count(),
    inventoryItems: await prisma.inventoryItem.count(),
    suppliers: await prisma.supplier.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    vehicles: await prisma.vehicle.count(),
    assets: await prisma.asset.count(),
  };
}
