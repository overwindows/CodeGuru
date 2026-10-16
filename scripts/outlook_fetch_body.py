import sys, json, time, os, urllib.parse
sys.path.insert(0, r"C:/Users/wuc/.brain/BrainCore/.claude/skills/teams")
sys.path.insert(0, r"Q:/CodeGuru/scripts")
import requests
from outlook_graph_lib import get_token, enc

OUT = r"Q:/CodeGuru/knowledgebase/segments"

IDS = sys.argv[1:]
def fetch(token, mid):
    url = f"/me/messages/{enc(mid)}?$select=id,subject,from,toRecipients,receivedDateTime,body"
    headers={"Authorization":f"Bearer {token}"}
    for attempt in range(5):
        r = requests.get("https://graph.microsoft.com/v1.0"+url, headers=headers, timeout=90)
        if r.status_code==429:
            time.sleep(float(r.headers.get('Retry-After',10))+1); continue
        if r.status_code==200:
            return r.json()
        return {"error": r.status_code, "text": r.text[:400]}
    return {"error": "exhausted"}

def strip(text):
    if not text: return text
    import re
    text=re.sub(r'<br\s*/?>','\n',text)
    text=re.sub(r'</p>','\n\n',text)
    text=re.sub(r'<[^>]+>','',text)
    return text

def main():
    token=get_token()
    for mid in IDS:
        m=fetch(token, mid)
        subj=m.get('subject','?')
        body=strip(m.get('body',{}).get('content',''))
        d=(m.get('receivedDateTime') or '')[:10]
        print("="*90)
        print(f"[{d}] {subj}")
        print("-"*90)
        print(body[:4000])
        print()

if __name__=="__main__":
    main()
