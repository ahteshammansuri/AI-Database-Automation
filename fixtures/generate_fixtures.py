#!/usr/bin/env python3
"""Deterministic generator for the data-agent fixture databases (synthetic data only).

Writes identical logical content for MySQL 8 and PostgreSQL 16:
  fixtures/sql/{mysql,postgres}/NN_<db>.sql   docker init wrappers (create DB, load body)
  fixtures/sql/{mysql,postgres}/body/<db>.sql schema + data, one statement per ';\n'
  fixtures/sql/{mysql,postgres}/90_grants.sql restricted users fx_ro / fx_rw / fx_rwd
  fixtures/expected/dummy_labels.json         ground truth for dummy-data detection
  fixtures/expected/anchors.json              the fixed clock the time-window tests use

Databases:
  shopfx    conventional e-commerce schema (users, orders, products, junction, soft-delete,
            table without PK, restricted/secret tables, timestamp + timestamptz columns)
  shopfx_w  identical copy that write/delete tests re-seed and modify
  legacyfx  unconventional names (tbl_acct_main is the user table)
  crmfx     second database that ALSO has a `users` table (connection disambiguation)

All people, emails, phones and card numbers are invented. Run: python3 fixtures/generate_fixtures.py
"""
from __future__ import annotations

import json
import os
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

ROOT = os.path.dirname(os.path.abspath(__file__))
UTC = timezone.utc
# Fixed clock for every time-relative test: 2026-10-15 12:00 in Asia/Kolkata.
NOW = datetime(2026, 10, 15, 6, 30, 0, tzinfo=UTC)

FIRST = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan",
         "Ananya", "Diya", "Aadhya", "Saanvi", "Pari", "Anika", "Navya", "Myra", "Sara", "Ira",
         "Kabir", "Meera", "Nisha", "Rahul", "Sneha", "Vikram", "Pooja", "Karan", "Neha", "Amit",
         "Riya", "Manish", "Kavya", "Deepak", "Tanvi", "Harsh", "Isha", "Yash", "Lakshmi", "Farhan"]
LAST = ["Sharma", "Verma", "Gupta", "Patel", "Shah", "Reddy", "Nair", "Iyer", "Singh", "Kumar",
        "Joshi", "Chopra", "Malhotra", "Bose", "Das", "Rao", "Pillai", "Kapoor", "Agarwal", "Khan"]
DOMAINS = ["gmail.com", "yahoo.co.in", "outlook.com", "rediffmail.com", "protonmail.com", "acme-corp.in"]
REGIONS = ["RJ", "MH", "DL", "KA", "GJ", "TN", "WB", "UP", "PB", "HR"]
REGION_NAMES = {"RJ": "Rajasthan", "MH": "Maharashtra", "DL": "Delhi", "KA": "Karnataka", "GJ": "Gujarat",
                "TN": "Tamil Nadu", "WB": "West Bengal", "UP": "Uttar Pradesh", "PB": "Punjab", "HR": "Haryana"}
DUMMY_HASH = "$2y$10$SeededDefaultHashSeededDefaultHashSeededDefaultHash00"


def ts(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


class Sql:
    """Collects statements and renders literals for one dialect."""

    def __init__(self, dialect: str):
        self.d = dialect
        self.out: list[str] = []

    def lit(self, v) -> str:
        if v is None:
            return "NULL"
        if isinstance(v, bool):
            return "TRUE" if v else "FALSE"
        if isinstance(v, (int, Decimal)):
            return str(v)
        if isinstance(v, float):
            return f"{v:.2f}"
        if isinstance(v, TzTs):
            return f"'{ts(v.dt)}'" if self.d == "mysql" else f"'{ts(v.dt)}+00'"
        if isinstance(v, NaiveTs):
            return f"'{ts(v.dt)}'"
        s = str(v)
        assert "\\" not in s and ";\n" not in s
        return "'" + s.replace("'", "''") + "'"

    def stmt(self, s: str):
        self.out.append(s.strip() + ";")

    def insert(self, table: str, cols: list[str], rows: list[list], batch: int = 50):
        for i in range(0, len(rows), batch):
            chunk = rows[i:i + batch]
            values = ",\n  ".join("(" + ", ".join(self.lit(v) for v in r) + ")" for r in chunk)
            self.stmt(f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n  {values}")

    def text(self) -> str:
        return "\n".join(self.out) + "\n"


class TzTs:
    """A timezone-aware instant: MySQL TIMESTAMP (session UTC) / PostgreSQL timestamptz."""

    def __init__(self, dt: datetime):
        self.dt = dt


class NaiveTs:
    """A wall-clock value without zone: MySQL DATETIME / PostgreSQL timestamp (stored as UTC by convention)."""

    def __init__(self, dt: datetime):
        self.dt = dt


# ----------------------------------------------------------------------------------------------
# Logical data (dialect independent)
# ----------------------------------------------------------------------------------------------

def build_shop(rng: random.Random) -> dict:
    users = []
    used_emails = set()

    def email_for(first, last, domain):
        base = f"{first.lower()}.{last.lower()}"
        e = f"{base}@{domain}"
        n = 2
        while e in used_emails:
            e = f"{base}{n}@{domain}"
            n += 1
        used_emails.add(e)
        return e

    def phone():
        return str(rng.choice([6, 7, 8, 9])) + "".join(str(rng.randint(0, 9)) for _ in range(9))

    def real_hash():
        return "$2y$10$" + "".join(rng.choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./") for _ in range(53))

    rajasthan_left = 8
    for i in range(46):
        first, last = FIRST[i % len(FIRST)], LAST[(i * 7) % len(LAST)]
        region = "RJ" if rajasthan_left > 0 and i % 5 == 0 else REGIONS[(i * 3) % len(REGIONS)]
        if region == "RJ":
            rajasthan_left -= 1
        created = NOW - timedelta(days=rng.randint(3, 120), hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
        status = "inactive" if i % 11 == 4 else ("banned" if i in (17, 33) else "active")
        users.append(dict(name=f"{first} {last}", email=email_for(first, last, DOMAINS[i % len(DOMAINS)]),
                          password_hash=real_hash(), region=region, phone=phone(), status=status,
                          created_at=created, registered_at=created - timedelta(hours=rng.randint(0, 48)), dummy=False))

    # Adversarial look-alikes that are NOT dummy data (precision check).
    users.append(dict(name="John Dsouza", email=email_for("john", "dsouza", "gmail.com"), password_hash=real_hash(),
                      region="MH", phone=phone(), status="active", created_at=NOW - timedelta(days=40, hours=5),
                      registered_at=NOW - timedelta(days=40, hours=6), dummy=False))
    users.append(dict(name="Marco Testa", email="marco.testa@contest.in", password_hash=real_hash(), region="KA",
                      phone=phone(), status="active", created_at=NOW - timedelta(days=22, hours=2),
                      registered_at=None, dummy=False))
    # Two people with the same name (ambiguous singular update -> must ask which one).
    users.append(dict(name="Priya Sharma", email="priya.sharma@gmail.com", password_hash=real_hash(), region="DL",
                      phone=phone(), status="active", created_at=NOW - timedelta(days=60), registered_at=NOW - timedelta(days=60), dummy=False))
    users.append(dict(name="Priya Sharma", email="priya.sharma.work@acme-corp.in", password_hash=real_hash(), region="GJ",
                      phone=phone(), status="active", created_at=NOW - timedelta(days=12), registered_at=NOW - timedelta(days=12), dummy=False))
    # A unique person for single-row update tests.
    users.append(dict(name="Rohan Mehta", email="rohan.mehta@outlook.com", password_hash=real_hash(), region="RJ",
                      phone=phone(), status="active", created_at=NOW - timedelta(days=30), registered_at=NOW - timedelta(days=31), dummy=False))

    # Midnight boundary users (Asia/Kolkata midnight = 18:30 UTC).
    boundary = [
        ("Aditi Rao", datetime(2026, 10, 14, 18, 29, 59, tzinfo=UTC)),   # yesterday in IST and UTC
        ("Bhavna Iyer", datetime(2026, 10, 14, 18, 30, 0, tzinfo=UTC)),  # today in IST, yesterday in UTC
        ("Chetan Nair", datetime(2026, 10, 15, 0, 0, 0, tzinfo=UTC)),    # today in IST and UTC
        ("Divya Bose", datetime(2026, 10, 15, 18, 29, 59, tzinfo=UTC)),  # today in IST and UTC
        ("Eshan Kapoor", datetime(2026, 10, 15, 18, 30, 0, tzinfo=UTC)), # tomorrow in IST, today in UTC
    ]
    for name, at in boundary:
        f, l = name.split()
        users.append(dict(name=name, email=email_for(f, l, "gmail.com"), password_hash=real_hash(), region=rng.choice(REGIONS),
                          phone=phone(), status="active", created_at=at, registered_at=at, dummy=False, boundary=True))

    # Dummy / test accounts (ground truth for detection).
    burst = datetime(2026, 7, 1, 10, 0, 0, tzinfo=UTC)
    dummies = [
        ("Test User", "test@example.com", "1234567890", burst),
        ("asdf asdf", "asdf@asdf.com", "0000000000", burst),
        ("John Doe", "john.doe@test.com", "9999999999", burst),
        ("Jane Doe", "jane.doe@example.org", "1111111111", burst),
        ("user1", "user1@mailinator.com", "1234567890", burst),
        ("user2", "user2@mailinator.com", "1234567890", burst),
        ("Demo Account", "demo@demo.com", "0000000000", NOW - timedelta(days=50)),
        ("Lorem Ipsum", "lorem@ipsum.com", None, NOW - timedelta(days=45)),
        ("Fake Person", "fake.person@fakemail.com", "9999999999", NOW - timedelta(days=44)),
        ("qwerty", "qwerty@yopmail.com", "1111111111", NOW - timedelta(days=43)),
    ]
    for name, email, ph, at in dummies:
        users.append(dict(name=name, email=email, password_hash=DUMMY_HASH, region=rng.choice(REGIONS), phone=ph,
                          status="active", created_at=at, registered_at=at, dummy=True))

    for idx, u in enumerate(users, start=1):
        u["id"] = idx
        u["remember_token"] = None if idx % 3 else "".join(rng.choice("abcdef0123456789") for _ in range(60))
        u["updated_at"] = None

    categories = [(1, "Smart Phones", "smart-phones"), (2, "Feature Phones", "feature-phones"), (3, "Laptops", "laptops"),
                  (4, "Audio", "audio"), (5, "Home Appliances", "home-appliances"), (6, "Books", "books")]
    product_names = {
        1: ["Nova X1", "Nova X2 Pro", "Orbit 5G", "Pixelite S"],
        2: ["Basic 105", "Classic 3310", "Sturdy B2"],
        3: ["AirBook 13", "WorkPro 15", "GamerX 17", "StudentLite 14"],
        4: ["BassBuds", "StudioCans", "SoundBar 300", "Neckband Go", "Party Speaker"],
        5: ["Mixer Grinder 750W", "Air Fryer 4L", "Induction Cooktop", "Water Purifier RO"],
        6: ["Data Systems 101", "The Monsoon Novel", "Cooking Basics", "Indian History Atlas", "Python for Everyone",
            "Startup Stories", "Poems of the Hills", "Astronomy Now", "Chess Openings", "Mindful Mornings"],
    }
    products = []
    pid = 1
    for cat_id, names in product_names.items():
        for n in names:
            base = {1: 18000, 2: 1500, 3: 55000, 4: 2500, 5: 4000, 6: 450}[cat_id]
            price = Decimal(base + rng.randint(-base // 4, base // 2)).quantize(Decimal("1")) + Decimal("0.99") - 1
            products.append(dict(id=pid, sku=f"SKU-{1000 + pid}", name=n, category_id=cat_id, price=price,
                                 stock=rng.randint(0, 250), is_active=(pid % 9 != 0),
                                 description=f"{n} from the {categories[cat_id - 1][1]} range.",
                                 created_at=NOW - timedelta(days=rng.randint(100, 300))))
            pid += 1
    tags = [(1, "bestseller"), (2, "new"), (3, "sale"), (4, "premium"), (5, "budget"), (6, "gift"), (7, "eco"), (8, "limited")]
    product_tags = sorted({(p["id"], t) for p in products for t in rng.sample(range(1, 9), rng.randint(0, 3))})

    # Orders go to users 1-40, Rohan Mehta, two boundary users and John Dsouza; everyone else has none.
    order_users = [u["id"] for u in users if not u["dummy"] and not u.get("boundary") and u["id"] <= 40] + [51, 52, 53, 47]
    orders, items, payments = [], [], []
    oid, iid, payid = 1, 1, 1
    statuses = ["pending", "paid", "paid", "shipped", "shipped", "shipped", "cancelled", "refunded"]
    for k in range(150):
        uid = order_users[k % len(order_users)] if k % 3 else rng.choice(order_users)
        created = NOW - timedelta(days=rng.randint(1, 60), hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
        orders.append(dict(id=oid, user_id=uid, status=rng.choice(statuses), created_at=created))
        oid += 1
    # Orders "today" in IST: window [2026-10-14 18:30Z, 2026-10-15 18:30Z)
    for at, st in [(datetime(2026, 10, 14, 18, 30, 0, tzinfo=UTC), "paid"), (datetime(2026, 10, 14, 20, 15, tzinfo=UTC), "pending"),
                   (datetime(2026, 10, 15, 1, 5, tzinfo=UTC), "paid"), (datetime(2026, 10, 15, 3, 40, tzinfo=UTC), "shipped"),
                   (datetime(2026, 10, 15, 5, 55, tzinfo=UTC), "pending"), (datetime(2026, 10, 15, 6, 10, tzinfo=UTC), "paid"),
                   (datetime(2026, 10, 15, 6, 29, tzinfo=UTC), "cancelled"),
                   (datetime(2026, 10, 14, 18, 29, 59, tzinfo=UTC), "paid"),   # yesterday (IST)
                   (datetime(2026, 10, 15, 18, 30, 0, tzinfo=UTC), "pending")]:  # tomorrow (IST)
        orders.append(dict(id=oid, user_id=rng.choice(order_users[:30]), status=st, created_at=at))
        oid += 1
    for o in orders:
        total = Decimal("0.00")
        for _ in range(rng.randint(1, 3)):
            p = rng.choice(products)
            qty = rng.randint(1, 3)
            items.append(dict(id=iid, order_id=o["id"], product_id=p["id"], qty=qty, unit_price=p["price"]))
            total += p["price"] * qty
            iid += 1
        o["total"] = total.quantize(Decimal("0.01"))
        o["order_no"] = f"ORD-{20260000 + o['id']}"
        o["currency"] = "INR"
        if o["status"] in ("paid", "shipped", "refunded"):
            method = rng.choice(["upi", "card", "netbanking", "upi"])
            payments.append(dict(id=payid, order_id=o["id"], amount=o["total"], method=method,
                                 card_number=("4111" + "".join(str(rng.randint(0, 9)) for _ in range(12))) if method == "card" else None,
                                 status="refunded" if o["status"] == "refunded" else "captured",
                                 paid_at=o["created_at"] + timedelta(minutes=rng.randint(1, 30))))
            payid += 1

    notes = []
    for n in range(1, 21):
        uid = rng.choice([u["id"] for u in users if not u["dummy"]][:48])
        notes.append(dict(id=n, user_id=uid, body=rng.choice(["Asked about delivery time.", "Prefers UPI payments.",
                                                                 "Requested invoice copy.", "Interested in laptops.",
                                                                 "Called support twice this month."]),
                          created_at=NOW - timedelta(days=rng.randint(1, 90)),
                          deleted_at=(NOW - timedelta(days=rng.randint(0, 5))) if n % 6 == 0 else None))
    tokens = [dict(id=t, user_id=rng.choice([1, 2, 3, 4, 5, 44, 45, 46]), token="".join(rng.choice("abcdef0123456789") for _ in range(64)),
                   created_at=NOW - timedelta(days=rng.randint(1, 30)), last_used_at=None) for t in range(1, 16)]
    views = [dict(path=rng.choice(["/", "/products", "/cart", "/checkout", "/blog", "/about"]),
                  user_id=rng.choice([None, rng.randint(1, 50)]),
                  viewed_at=NOW - timedelta(minutes=rng.randint(1, 60 * 24 * 14))) for _ in range(200)]
    audit = [dict(id=a, actor=rng.choice(["system", "admin", "support"]), action=rng.choice(["login", "export", "price_change", "refund"]),
                  created_at=NOW - timedelta(days=rng.randint(0, 30))) for a in range(1, 51)]
    posts = []
    real_titles = ["Choosing the right laptop for college", "Five budget earbuds compared", "How to care for your air fryer",
                   "Monsoon reading list", "Smartphone camera tips", "Festive gift guide", "Saving power at home",
                   "Why feature phones still sell", "Setting up a home studio", "Beginner chess openings explained",
                   "Water purifier buying guide", "What is 5G, really?"]
    for i, t in enumerate(real_titles, start=1):
        posts.append(dict(id=i, title=t, slug=t.lower().replace(" ", "-").replace(",", "").replace("?", ""),
                          body=f"{t}. A practical guide written for our customers with clear, honest advice.",
                          status="published" if i % 4 else "draft", author_id=rng.choice([1, 2, 3, 7]),
                          published_at=(NOW - timedelta(days=i * 3)) if i % 4 else None, created_at=NOW - timedelta(days=i * 3 + 1), dummy=False))
    for i, (t, b) in enumerate([("Lorem ipsum dolor sit amet", "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor."),
                                ("Test post", "test test test"), ("asdf", "asdfasdf qwerty")], start=len(real_titles) + 1):
        posts.append(dict(id=i, title=t, slug=f"draft-{i}", body=b, status="draft", author_id=None, published_at=None,
                          created_at=NOW - timedelta(days=2), dummy=True))

    return dict(users=users, categories=categories, products=products, tags=tags, product_tags=product_tags,
                orders=orders, items=items, payments=payments, notes=notes, tokens=tokens, views=views,
                audit=audit, posts=posts)


def build_legacy(rng: random.Random) -> dict:
    accts = []
    for i in range(1, 31):
        f, l = FIRST[(i * 5) % len(FIRST)], LAST[(i * 3) % len(LAST)]
        accts.append(dict(acct_id=i, usr_nm=f"{f} {l}", eml_addr=f"{f.lower()}{i}@{DOMAINS[i % len(DOMAINS)]}",
                          pwd_hsh="$2y$10$" + "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(53)),
                          rgn_cd=REGIONS[i % len(REGIONS)], crt_dt=NOW - timedelta(days=rng.randint(1, 365)),
                          stat_cd="A" if i % 7 else "I"))
    orders = [dict(ord_id=o, acct_id=rng.randint(1, 30), ord_amt=Decimal(rng.randint(200, 90000)) / 100 * 10,
                   ord_dt=NOW - timedelta(days=rng.randint(0, 90)), ord_stat=rng.choice(["NEW", "PAID", "SHIP", "CANC"])) for o in range(1, 61)]
    prods = [dict(prd_id=p, prd_nm=f"Item {p:03d}", prc=Decimal(rng.randint(100, 50000)) / 100, qty_on_hnd=rng.randint(0, 500)) for p in range(1, 16)]
    cfg = [("site_name", "Legacy Store"), ("currency", "INR"), ("tax_rate", "18"), ("support_email", "help@legacy.example"), ("theme", "classic")]
    evts = [dict(evt_id=e, evt_typ=rng.choice(["LOGIN", "LOGOUT", "PWD_RESET", "EXPORT"]), evt_ts=NOW - timedelta(hours=rng.randint(1, 500))) for e in range(1, 41)]
    return dict(accts=accts, orders=orders, prods=prods, cfg=cfg, evts=evts)


def build_crm(rng: random.Random) -> dict:
    names = ["Olivia Fernandes", "Rehan Siddiqui", "Tara Menon", "Gaurav Bhatia", "Zoya Mirza", "Kunal Desai", "Sana Qureshi",
             "Varun Saxena", "Anjali Kulkarni", "Imran Sheikh", "Leela Pillai", "Mohit Arora", "Nandini Ghosh", "Om Prakash",
             "Rhea D'Costa", "Siddharth Jain", "Tanya Roy", "Uday Naidu", "Vani Hegde", "Rohan Mehta"]
    users = [dict(id=i, name=n, email=n.lower().replace(" ", ".").replace("'", "") + "@crm-client.in",
                  company=rng.choice(["Acme Traders", "Blue Lotus Pvt Ltd", "Sunrise Foods", "Kite Logistics"]),
                  created_at=NOW - timedelta(days=rng.randint(1, 200))) for i, n in enumerate(names, start=1)]
    contacts = [dict(id=c, user_id=rng.randint(1, 20), phone="9" + "".join(str(rng.randint(0, 9)) for _ in range(9)),
                     city=rng.choice(["Jaipur", "Pune", "Chennai", "Kolkata", "Lucknow"])) for c in range(1, 31)]
    leads = [dict(id=l, owner_id=rng.randint(1, 20), title=f"Lead {l:03d}", stage=rng.choice(["new", "qualified", "won", "lost"]),
                  value=Decimal(rng.randint(1000, 500000)), created_at=NOW - timedelta(days=rng.randint(0, 120))) for l in range(1, 41)]
    return dict(users=users, contacts=contacts, leads=leads)


# ----------------------------------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------------------------------

def render_shop(d: str, data: dict) -> str:
    s = Sql(d)
    my = d == "mysql"
    pk = "INT NOT NULL AUTO_INCREMENT PRIMARY KEY" if my else "INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"
    tstz = "TIMESTAMP" if my else "TIMESTAMPTZ"
    naive = "DATETIME" if my else "TIMESTAMP"
    boolean = "TINYINT(1)" if my else "BOOLEAN"
    tail = " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" if my else ""
    if not my:
        s.stmt("CREATE TYPE order_status AS ENUM ('pending','paid','shipped','cancelled','refunded')")
    user_status = "ENUM('active','inactive','banned') NOT NULL DEFAULT 'active'" if my else \
        "VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','banned'))"
    s.stmt(f"""CREATE TABLE users (
  id {pk},
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  remember_token VARCHAR(100) NULL,
  region VARCHAR(40) NULL,
  phone VARCHAR(20) NULL,
  status {user_status},
  created_at {tstz} NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registered_at {naive} NULL,
  updated_at {tstz} NULL
){tail}""")
    s.stmt(f"CREATE TABLE categories (id {pk}, name VARCHAR(80) NOT NULL UNIQUE, slug VARCHAR(80) NOT NULL UNIQUE){tail}")
    s.stmt(f"""CREATE TABLE products (
  id {pk},
  sku VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category_id INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  is_active {boolean} NOT NULL DEFAULT {'1' if my else 'TRUE'},
  description TEXT NULL,
  created_at {tstz} NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
){tail}""")
    s.stmt(f"CREATE TABLE tags (id {pk}, name VARCHAR(50) NOT NULL UNIQUE){tail}")
    s.stmt(f"""CREATE TABLE product_tags (
  product_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (product_id, tag_id),
  CONSTRAINT fk_pt_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
){tail}""")
    order_status = "ENUM('pending','paid','shipped','cancelled','refunded') NOT NULL" if my else "order_status NOT NULL"
    s.stmt(f"""CREATE TABLE orders (
  id {pk},
  user_id INT NOT NULL,
  order_no VARCHAR(20) NOT NULL UNIQUE,
  status {order_status},
  total DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_at {tstz} NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
){tail}""")
    s.stmt(f"""CREATE TABLE order_items (
  id {pk},
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  qty INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
){tail}""")
    s.stmt(f"""CREATE TABLE payments (
  id {pk},
  order_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(20) NOT NULL,
  card_number VARCHAR(19) NULL,
  status VARCHAR(20) NOT NULL,
  paid_at {tstz} NULL,
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
){tail}""")
    s.stmt(f"""CREATE TABLE customer_notes (
  id {pk},
  user_id INT NULL,
  body TEXT NOT NULL,
  created_at {tstz} NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at {tstz} NULL,
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
){tail}""")
    s.stmt(f"""CREATE TABLE api_tokens (
  id {pk},
  user_id INT NOT NULL,
  token VARCHAR(64) NOT NULL,
  created_at {tstz} NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at {tstz} NULL,
  CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
){tail}""")
    s.stmt(f"CREATE TABLE page_views (path VARCHAR(200) NOT NULL, user_id INT NULL, viewed_at {tstz} NOT NULL){tail}")
    s.stmt(f"CREATE TABLE audit_events (id {pk}, actor VARCHAR(100) NOT NULL, action VARCHAR(100) NOT NULL, created_at {tstz} NOT NULL){tail}")
    s.stmt(f"""CREATE TABLE posts (
  id {pk},
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  author_id INT NULL,
  published_at {tstz} NULL,
  created_at {tstz} NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
){tail}""")
    if my:
        s.stmt("ALTER TABLE users COMMENT = 'Customer accounts'")
    else:
        s.stmt("COMMENT ON TABLE users IS 'Customer accounts'")

    u = data["users"]
    s.insert("users", ["id", "name", "email", "password_hash", "remember_token", "region", "phone", "status", "created_at", "registered_at", "updated_at"],
             [[x["id"], x["name"], x["email"], x["password_hash"], x["remember_token"], x["region"], x["phone"], x["status"],
               TzTs(x["created_at"]), NaiveTs(x["registered_at"]) if x["registered_at"] else None, None] for x in u])
    s.insert("categories", ["id", "name", "slug"], [list(c) for c in data["categories"]])
    s.insert("products", ["id", "sku", "name", "category_id", "price", "stock", "is_active", "description", "created_at"],
             [[p["id"], p["sku"], p["name"], p["category_id"], p["price"], p["stock"], p["is_active"], p["description"], TzTs(p["created_at"])] for p in data["products"]])
    s.insert("tags", ["id", "name"], [list(t) for t in data["tags"]])
    s.insert("product_tags", ["product_id", "tag_id"], [list(t) for t in data["product_tags"]])
    s.insert("orders", ["id", "user_id", "order_no", "status", "total", "currency", "created_at"],
             [[o["id"], o["user_id"], o["order_no"], o["status"], o["total"], o["currency"], TzTs(o["created_at"])] for o in data["orders"]])
    s.insert("order_items", ["id", "order_id", "product_id", "qty", "unit_price"],
             [[i["id"], i["order_id"], i["product_id"], i["qty"], i["unit_price"]] for i in data["items"]])
    s.insert("payments", ["id", "order_id", "amount", "method", "card_number", "status", "paid_at"],
             [[p["id"], p["order_id"], p["amount"], p["method"], p["card_number"], p["status"], TzTs(p["paid_at"])] for p in data["payments"]])
    s.insert("customer_notes", ["id", "user_id", "body", "created_at", "deleted_at"],
             [[n["id"], n["user_id"], n["body"], TzTs(n["created_at"]), TzTs(n["deleted_at"]) if n["deleted_at"] else None] for n in data["notes"]])
    s.insert("api_tokens", ["id", "user_id", "token", "created_at", "last_used_at"],
             [[t["id"], t["user_id"], t["token"], TzTs(t["created_at"]), None] for t in data["tokens"]])
    s.insert("page_views", ["path", "user_id", "viewed_at"], [[v["path"], v["user_id"], TzTs(v["viewed_at"])] for v in data["views"]])
    s.insert("audit_events", ["id", "actor", "action", "created_at"], [[a["id"], a["actor"], a["action"], TzTs(a["created_at"])] for a in data["audit"]])
    s.insert("posts", ["id", "title", "slug", "body", "status", "author_id", "published_at", "created_at"],
             [[p["id"], p["title"], p["slug"], p["body"], p["status"], p["author_id"], TzTs(p["published_at"]) if p["published_at"] else None, TzTs(p["created_at"])] for p in data["posts"]])
    if not my:
        for t in ["users", "categories", "products", "tags", "orders", "order_items", "payments", "customer_notes", "api_tokens", "audit_events", "posts"]:
            s.stmt(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), (SELECT MAX(id) FROM {t}))")
    return s.text()


def render_legacy(d: str, data: dict) -> str:
    s = Sql(d)
    my = d == "mysql"
    tail = " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" if my else ""
    naive = "DATETIME" if my else "TIMESTAMP"
    s.stmt(f"CREATE TABLE lkp_rgn (rgn_cd VARCHAR(2) NOT NULL PRIMARY KEY, rgn_nm VARCHAR(60) NOT NULL){tail}")
    s.stmt(f"""CREATE TABLE tbl_acct_main (
  acct_id INT NOT NULL PRIMARY KEY,
  usr_nm VARCHAR(100) NOT NULL,
  eml_addr VARCHAR(190) NOT NULL,
  pwd_hsh VARCHAR(255) NOT NULL,
  rgn_cd VARCHAR(2) NULL,
  crt_dt {naive} NOT NULL,
  stat_cd CHAR(1) NOT NULL DEFAULT 'A',
  CONSTRAINT fk_acct_rgn FOREIGN KEY (rgn_cd) REFERENCES lkp_rgn(rgn_cd)
){tail}""")
    s.stmt(f"""CREATE TABLE tbl_ord_hdr (
  ord_id INT NOT NULL PRIMARY KEY,
  acct_id INT NOT NULL,
  ord_amt DECIMAL(12,2) NOT NULL,
  ord_dt {naive} NOT NULL,
  ord_stat VARCHAR(10) NOT NULL,
  CONSTRAINT fk_ord_acct FOREIGN KEY (acct_id) REFERENCES tbl_acct_main(acct_id) ON DELETE RESTRICT
){tail}""")
    s.stmt(f"CREATE TABLE tbl_prd_mst (prd_id INT NOT NULL PRIMARY KEY, prd_nm VARCHAR(120) NOT NULL, prc DECIMAL(10,2) NOT NULL, qty_on_hnd INT NOT NULL){tail}")
    s.stmt(f"CREATE TABLE sys_cfg (cfg_key VARCHAR(64) NOT NULL PRIMARY KEY, cfg_val VARCHAR(255) NOT NULL){tail}")
    s.stmt(f"CREATE TABLE tbl_evt_log (evt_id INT NOT NULL PRIMARY KEY, evt_typ VARCHAR(20) NOT NULL, evt_ts {naive} NOT NULL){tail}")
    s.insert("lkp_rgn", ["rgn_cd", "rgn_nm"], [[k, v] for k, v in REGION_NAMES.items()])
    s.insert("tbl_acct_main", ["acct_id", "usr_nm", "eml_addr", "pwd_hsh", "rgn_cd", "crt_dt", "stat_cd"],
             [[a["acct_id"], a["usr_nm"], a["eml_addr"], a["pwd_hsh"], a["rgn_cd"], NaiveTs(a["crt_dt"]), a["stat_cd"]] for a in data["accts"]])
    s.insert("tbl_ord_hdr", ["ord_id", "acct_id", "ord_amt", "ord_dt", "ord_stat"],
             [[o["ord_id"], o["acct_id"], o["ord_amt"].quantize(Decimal("0.01")), NaiveTs(o["ord_dt"]), o["ord_stat"]] for o in data["orders"]])
    s.insert("tbl_prd_mst", ["prd_id", "prd_nm", "prc", "qty_on_hnd"], [[p["prd_id"], p["prd_nm"], p["prc"].quantize(Decimal("0.01")), p["qty_on_hnd"]] for p in data["prods"]])
    s.insert("sys_cfg", ["cfg_key", "cfg_val"], [list(c) for c in data["cfg"]])
    s.insert("tbl_evt_log", ["evt_id", "evt_typ", "evt_ts"], [[e["evt_id"], e["evt_typ"], NaiveTs(e["evt_ts"])] for e in data["evts"]])
    return s.text()


def render_crm(d: str, data: dict) -> str:
    s = Sql(d)
    my = d == "mysql"
    pk = "INT NOT NULL AUTO_INCREMENT PRIMARY KEY" if my else "INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"
    tstz = "TIMESTAMP" if my else "TIMESTAMPTZ"
    tail = " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" if my else ""
    s.stmt(f"CREATE TABLE users (id {pk}, name VARCHAR(100) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE, company VARCHAR(100) NULL, created_at {tstz} NOT NULL DEFAULT CURRENT_TIMESTAMP){tail}")
    s.stmt(f"CREATE TABLE contacts (id {pk}, user_id INT NOT NULL, phone VARCHAR(20) NULL, city VARCHAR(60) NULL, CONSTRAINT fk_contacts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE){tail}")
    s.stmt(f"CREATE TABLE leads (id {pk}, owner_id INT NOT NULL, title VARCHAR(120) NOT NULL, stage VARCHAR(20) NOT NULL, value DECIMAL(12,2) NOT NULL, created_at {tstz} NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_leads_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT){tail}")
    s.insert("users", ["id", "name", "email", "company", "created_at"], [[u["id"], u["name"], u["email"], u["company"], TzTs(u["created_at"])] for u in data["users"]])
    s.insert("contacts", ["id", "user_id", "phone", "city"], [[c["id"], c["user_id"], c["phone"], c["city"]] for c in data["contacts"]])
    s.insert("leads", ["id", "owner_id", "title", "stage", "value", "created_at"], [[l["id"], l["owner_id"], l["title"], l["stage"], l["value"], TzTs(l["created_at"])] for l in data["leads"]])
    if not my:
        for t in ["users", "contacts", "leads"]:
            s.stmt(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), (SELECT MAX(id) FROM {t}))")
    return s.text()


DBS = ["shopfx", "shopfx_w", "legacyfx", "crmfx"]
# Fixture-only credentials for disposable containers bound to 127.0.0.1 (not product configuration).
FX_USERS = {"fx_ro": "fx_ro_pw", "fx_rw": "fx_rw_pw", "fx_rwd": "fx_rwd_pw"}


def mysql_grants() -> str:
    out = []
    for user, pw in FX_USERS.items():
        out.append(f"CREATE USER IF NOT EXISTS '{user}'@'%' IDENTIFIED BY '{pw}';")
    for db in DBS:
        out.append(f"GRANT SELECT ON {db}.* TO 'fx_ro'@'%';")
        out.append(f"GRANT SELECT, INSERT, UPDATE ON {db}.* TO 'fx_rw'@'%';")
        out.append(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {db}.* TO 'fx_rwd'@'%';")
    out.append("FLUSH PRIVILEGES;")
    return "\n".join(out) + "\n"


def postgres_grants() -> str:
    out = [f"CREATE ROLE {u} LOGIN PASSWORD '{pw}';" for u, pw in FX_USERS.items()]
    for db in DBS:
        out.append(f"\\connect {db}")
        out.append("GRANT USAGE ON SCHEMA public TO fx_ro, fx_rw, fx_rwd;")
        out.append("GRANT SELECT ON ALL TABLES IN SCHEMA public TO fx_ro;")
        out.append("GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO fx_rw;")
        out.append("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fx_rwd;")
        out.append("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fx_rw, fx_rwd;")
    return "\n".join(out) + "\n"


def main():
    shop = build_shop(random.Random(20261015))
    legacy = build_legacy(random.Random(7))
    crm = build_crm(random.Random(11))
    bodies = {"shopfx": render_shop, "shopfx_w": render_shop, "legacyfx": render_legacy, "crmfx": render_crm}
    payloads = {"shopfx": shop, "shopfx_w": shop, "legacyfx": legacy, "crmfx": crm}
    for d in ("mysql", "postgres"):
        base = os.path.join(ROOT, "sql", d)
        os.makedirs(os.path.join(base, "body"), exist_ok=True)
        for n, db in enumerate(DBS, start=1):
            body = bodies[db](d, payloads[db])
            with open(os.path.join(base, "body", f"{db}.sql"), "w") as f:
                f.write(body)
            with open(os.path.join(base, f"{n:02d}_{db}.sql"), "w") as f:
                if d == "mysql":
                    f.write(f"CREATE DATABASE IF NOT EXISTS {db} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nUSE {db};\nSOURCE /docker-entrypoint-initdb.d/body/{db}.sql;\n")
                else:
                    f.write(f"CREATE DATABASE {db};\n\\connect {db}\n\\i /docker-entrypoint-initdb.d/body/{db}.sql\n")
        with open(os.path.join(base, "90_grants.sql"), "w") as f:
            f.write(mysql_grants() if d == "mysql" else postgres_grants())

    exp = os.path.join(ROOT, "expected")
    os.makedirs(exp, exist_ok=True)
    with open(os.path.join(exp, "dummy_labels.json"), "w") as f:
        json.dump({
            "shopfx.users": sorted(u["id"] for u in shop["users"] if u["dummy"]),
            "shopfx.posts": sorted(p["id"] for p in shop["posts"] if p["dummy"]),
            "_note": "Ground truth for dummy-data detection. Look-alikes that must NOT be flagged: John Dsouza, Marco Testa (contest.in).",
        }, f, indent=2)
    with open(os.path.join(exp, "anchors.json"), "w") as f:
        json.dump({
            "now_utc": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "timezone": "Asia/Kolkata",
            "users_today_ist": sorted(u["name"] for u in shop["users"] if datetime(2026, 10, 14, 18, 30, tzinfo=UTC) <= u["created_at"] < datetime(2026, 10, 15, 18, 30, tzinfo=UTC)),
            "users_today_utc": sorted(u["name"] for u in shop["users"] if datetime(2026, 10, 15, tzinfo=UTC) <= u["created_at"] < datetime(2026, 10, 16, tzinfo=UTC)),
            "orders_today_ist": sum(1 for o in shop["orders"] if datetime(2026, 10, 14, 18, 30, tzinfo=UTC) <= o["created_at"] < datetime(2026, 10, 15, 18, 30, tzinfo=UTC)),
            "rajasthan_users": sum(1 for u in shop["users"] if u["region"] == "RJ"),
            "users_without_orders": sorted(u["id"] for u in shop["users"] if u["id"] not in {o["user_id"] for o in shop["orders"]}),
        }, f, indent=2)
    print("fixtures written")


if __name__ == "__main__":
    main()
