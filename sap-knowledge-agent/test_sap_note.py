import requests

# Test me.sap.com search API
response = requests.get(
    "https://me.sap.com/api/search",
    params={"q": "memory dump ABAP", "type": "notes"},
    timeout=10,
    headers={"User-Agent": "Mozilla/5.0"},
)
print("Status:", response.status_code)
print("Response:", response.text[:500])
