import os

support_path = r"c:\Users\Rahul\Desktop\teen\admin-panel\src\pages\Support.tsx"

kb_definitions = """
const KB_CATEGORIES: Record<string, { label: string, color: string }> = {
  deposits: { label: 'Deposits & Withdrawals', color: 'blue' },
  kyc: { label: 'KYC & Verification', color: 'purple' },
  game_rules: { label: 'Game Rules', color: 'green' },
  technical: { label: 'Technical & Systems', color: 'orange' },
  general: { label: 'General / Other', color: 'cyan' },
}

function renderMarkdown(md: string) {
  if (!md) return null
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Headers
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>')

  // Bold / Italic
  html = html.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
  html = html.replace(/\\*(.*?)\\*/g, '<em>$1</em>')

  // Lists
  html = html.replace(/^\\*\\s+(.*?)$/gm, '<li>$1</li>')
  html = html.replace(/^\\d+\\.\\s+(.*?)$/gm, '<li>$1</li>')

  // Paragraphs
  const paragraphs = html.split(/\\n\\n+/)
  html = paragraphs.map(p => {
    const trimmed = p.trim()
    if (trimmed.startsWith('<h') || trimmed.startsWith('<li') || trimmed.startsWith('<li>')) {
      return p
    }
    return `<p>${p.replace(/\\n/g, '<br/>')}</p>`
  }).join('\\n')

  return (
    <div
      style={{
        lineHeight: '1.7',
        fontSize: '14px',
        color: '#434343',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
"""

def fix():
    with open(support_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Add import
    import_str = "import { adminApi } from '../api/client'"
    if import_str in content:
        content = content.replace(import_str, import_str + "\nimport { useAuthStore } from '../store/auth'")
    else:
        print("Could not find adminApi import!")
        return

    # Add KB definitions before KnowledgeBaseTab
    kb_tab_str = "function KnowledgeBaseTab()"
    if kb_tab_str in content:
        content = content.replace(kb_tab_str, kb_definitions + "\n" + kb_tab_str)
    else:
        print("Could not find KnowledgeBaseTab component!")
        return

    with open(support_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed Support.tsx successfully!")

if __name__ == "__main__":
    fix()
