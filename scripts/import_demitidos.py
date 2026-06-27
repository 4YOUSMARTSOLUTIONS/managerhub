import openpyxl, json, urllib.request, datetime

BASE = "https://vunsaeubucchjzovodkg.supabase.co"
APIKEY = "sb_publishable_XDV4wBM_tw6L2efm4a9QLQ_ajVeLuys"
XLSX = r"C:\Users\luiz.nobre\Desktop\colaboradores.xlsx"
DEFAULT_PASSWORD = "Mudar@123"

def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def iso(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return ""

tok = post(f"{BASE}/auth/v1/token?grant_type=password",
           {"email": "admin@managerhub.app", "password": "managerhub123"},
           {"apikey": APIKEY, "Content-Type": "application/json"})["access_token"]

wb = openpyxl.load_workbook(XLSX, data_only=True)
rows = list(wb.active.iter_rows(values_only=True))[1:]

payload = []
for r in rows:
    dem = r[10]
    if dem is None:                       # ativo -> ja importado
        continue
    if not isinstance(dem, (datetime.datetime, datetime.date)) or dem.year < 2024:
        continue                          # so demitidos de 2024 pra ca
    if not r[9]:
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
        "dismissed_at": iso(dem),
        "gender": str(r[12]).strip() if r[12] else "",
        "phone": str(r[13]).strip() if r[13] is not None else "",
        "email": str(r[14]).strip() if r[14] else "",
    })

print(f"Demitidos 2024+ a importar: {len(payload)}")
res = post(f"{BASE}/rest/v1/rpc/admin_import_employees",
           {"p_rows": payload, "p_password": DEFAULT_PASSWORD},
           {"apikey": APIKEY, "Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
print("Criados (inativos):", res.get("created"))
print("Pulados (CPF ja existia):", res.get("skipped"))
print("Erros:", len(res.get("errors", [])))
for e in res.get("errors", [])[:10]:
    print("  -", e)
