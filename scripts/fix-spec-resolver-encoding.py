from pathlib import Path

p = Path("packages/server/src/services/SpecResolverService.ts")
raw = p.read_bytes()
text = raw.decode("utf-16") if len(raw) > 2 and raw[1] == 0 else raw.decode("utf-8")
text = text.replace("await db\n", "await k\n")
text = text.replace("return db\n", "return k\n")
text = text.replace("let q = db\n", "let q = k\n")
if "const k = db as any" not in text:
    text = text.replace("from '../db';", "from '../db';\n\nconst k = db as any;")
# dedupe
parts = text.split("const k = db as any;")
if len(parts) > 2:
    text = parts[0] + "const k = db as any;" + "".join(parts[1:])
p.write_bytes(text.encode("utf-8"))
print("wrote", p.stat().st_size, p.read_bytes()[:60])
