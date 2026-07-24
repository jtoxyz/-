from pathlib import Path
import json
import subprocess

files = [
    Path('src/app/events/[id]/page.tsx'),
    Path('src/app/tickets/[publicToken]/page.tsx'),
    Path('src/components/EventPreviewModal.tsx'),
]

for path in files:
    text = path.read_text(encoding='utf-8')
    text = text.replace("import DOMPurify from 'isomorphic-dompurify';", "import DOMPurify from 'dompurify';")
    path.write_text(text, encoding='utf-8')

subprocess.run(['npm', 'uninstall', 'isomorphic-dompurify'], check=True)
subprocess.run(['npm', 'install', 'dompurify'], check=True)

package = Path('package.json')
data = json.loads(package.read_text(encoding='utf-8'))
assert 'isomorphic-dompurify' not in data.get('dependencies', {})
assert 'dompurify' in data.get('dependencies', {})
