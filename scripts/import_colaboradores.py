import openpyxl, re, json, urllib.request, datetime

BASE = "https://vunsaeubucchjzovodkg.supabase.co"
APIKEY = "sb_publishable_XDV4wBM_tw6L2efm4a9QLQ_ajVeLuys"
XLSX = r"C:\Users\luiz.nobre\Desktop\colaboradores.xlsx"
DEFAULT_PASSWORD = "Mudar@123"

def post(url, body, headers):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def iso(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return ""

# login admin
tok = post(f"{BASE}/auth/v1/token?grant_type=password",
           {"email": "admin@managerhub.app", "password": "managerhub123"},
           {"apikey": APIKEY, "Content-Type": "application/json"})["access_token"]

wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb.active
rows = list(ws.iter_rows(values_only=True))[1:]

payload = []
for r in rows:
    if r[10] is not None:   # tem Demissão -> demitido, pula
        continue
    if not r[9]:            # sem CPF
        continue
    payload.append({
        "unit": str(r[0]).strip() if r[0] else "",
        "employee_code": str(r[1]).strip() if r[1] is not None else "",
        "full_name": str(r[2]).strip() if r[2] else "",
        "admission_date": iso(r[3]),
        "position": str(r[4]).strip() if r[4] else "",
        "level": str(r[5]).strip() if r[5] else "",
        "department": str(r[6]).strip() if r[6] else "",
        "subdepartment": str(r[7]).strip() if r[7] else "",
        "birth_date": iso(r[8]),
        "cpf": str(r[9]).strip() if r[9] else "",
        "gender": str(r[12]).strip() if r[12] else "",
        "phone": str(r[13]).strip() if r[13] is not None else "",
        "email": str(r[14]).strip() if r[14] else "",
    })

print(f"Ativos a importar: {len(payload)}")
res = post(f"{BASE}/rest/v1/rpc/admin_import_employees",
           {"p_rows": payload, "p_password": DEFAULT_PASSWORD},
           {"apikey": APIKEY, "Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
print("Criados:", res.get("created"))
print("Pulados (CPF já existia):", res.get("skipped"))
errs = res.get("errors", [])
print("Erros:", len(errs))
for e in errs[:10]:
    print("  -", e)
