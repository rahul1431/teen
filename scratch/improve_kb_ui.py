import os

support_path = r"c:\Users\Rahul\Desktop\teen\admin-panel\src\pages\Support.tsx"

new_icons = "import { MessageOutlined, PlusOutlined, BookOutlined, SearchOutlined, EditOutlined, DeleteOutlined, WalletOutlined, SafetyCertificateOutlined, TrophyOutlined, SettingOutlined, QuestionCircleOutlined, ArrowRightOutlined } from '@ant-design/icons'"

preview_text_func = """
  const getPreviewText = (md: string) => {
    if (!md) return ''
    const clean = md
      .replace(/[#*`_\\[\\]()\\-]/g, '')
      .replace(/\\s+/g, ' ')
      .trim()
    return clean.length > 120 ? clean.substring(0, 120) + '...' : clean
  }

  const categoryIcons: Record<string, React.ReactNode> = {
    deposits: <WalletOutlined style={{ color: '#1890ff' }} />,
    kyc: <SafetyCertificateOutlined style={{ color: '#722ed1' }} />,
    game_rules: <TrophyOutlined style={{ color: '#52c41a' }} />,
    technical: <SettingOutlined style={{ color: '#fa8c16' }} />,
    general: <QuestionCircleOutlined style={{ color: '#13c2c2' }} />,
  }
"""

new_return_block = """  return (
    <div style={{ padding: '4px 0' }}>
      {/* Header Glass Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #11152c 0%, #0d1021 100%)',
        border: '1px solid rgba(214, 175, 55, 0.18)',
        borderRadius: '16px',
        padding: '36px 30px',
        color: '#fff',
        marginBottom: '24px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -50, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'rgba(214, 175, 55, 0.05)', filter: 'blur(40px)' }}></div>
        <h2 style={{ color: '#d4af37', margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '0.5px' }}>Knowledge Base & Operations Manual</h2>
        <p style={{ color: '#a6adb9', margin: '8px 0 0 0', fontSize: '14px', maxWidth: '600px' }}>
          Explore guidelines, troubleshoot manual deposits, verify KYC compliance, and configure game rules.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '24px' }}>
        {/* Left Side: Categories Box */}
        <div style={{
          flex: '0 0 280px',
          background: 'rgba(255, 255, 255, 0.65)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(0, 0, 0, 0.06)',
          borderRadius: '16px',
          padding: '20px 16px',
          boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.03)',
          width: '100%',
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#262626', marginBottom: '16px', paddingLeft: '8px' }}>Categories</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              onClick={() => setCategoryFilter(undefined)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: !categoryFilter ? 'rgba(212, 175, 55, 0.12)' : 'transparent',
                border: !categoryFilter ? '1px solid rgba(212, 175, 55, 0.3)' : '1px solid transparent',
              }}
            >
              <Space>
                <BookOutlined style={{ color: !categoryFilter ? '#d4af37' : '#8c8c8c' }} />
                <span style={{ fontWeight: !categoryFilter ? 600 : 500, color: !categoryFilter ? '#b8860b' : '#595959', fontSize: '13px' }}>All Articles</span>
              </Space>
              <Tag color={!categoryFilter ? 'gold' : 'default'} style={{ borderRadius: '10px' }}>{articles.length}</Tag>
            </div>

            {Object.entries(KB_CATEGORIES).map(([k, v]) => {
              const active = categoryFilter === k
              return (
                <div
                  key={k}
                  onClick={() => setCategoryFilter(k)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: active ? 'rgba(212, 175, 55, 0.12)' : 'transparent',
                    border: active ? '1px solid rgba(212, 175, 55, 0.3)' : '1px solid transparent',
                  }}
                >
                  <Space>
                    {categoryIcons[k] || <BookOutlined />}
                    <span style={{ fontWeight: active ? 600 : 500, color: active ? '#b8860b' : '#595959', fontSize: '13px' }}>{v.label}</span>
                  </Space>
                  <Tag color={active ? 'gold' : 'default'} style={{ borderRadius: '10px' }}>{articles.filter(a => a.category === k).length}</Tag>
                </div>
              )
            })}
          </div>

          {canWrite && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingArticle(null)
                form.resetFields()
                setEditorOpen(true)
              }}
              style={{ width: '100%', marginTop: '20px', borderRadius: '10px', height: '38px', fontWeight: 600, background: '#d4af37', borderColor: '#d4af37' }}
            >
              Create Article
            </Button>
          )}
        </div>

        {/* Right Side: Search and Glassy Cards Grid */}
        <div style={{ flex: 1, minWidth: '320px' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <Input
              placeholder="Search guides by title or keywords..."
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              allowClear
              onChange={(e) => setSearch(e.target.value)}
              style={{
                height: '42px',
                borderRadius: '12px',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
              }}
            />
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <Typography.Text type="secondary">Loading guides...</Typography.Text>
            </div>
          ) : articles.length === 0 ? (
            <div style={{
              background: 'rgba(255, 255, 255, 0.5)',
              borderRadius: '16px',
              padding: '60px 20px',
              textAlign: 'center',
              border: '1px dashed rgba(0, 0, 0, 0.1)',
            }}>
              <BookOutlined style={{ fontSize: '40px', color: '#bfbfbf', marginBottom: '16px' }} />
              <h3>No articles found</h3>
              <p style={{ color: '#8c8c8c' }}>Try adjusting your keywords or selecting another category.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
              {articles.map((art) => {
                const cat = KB_CATEGORIES[art.category] || { label: art.category, color: 'default' }
                return (
                  <div
                    key={art.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.75)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      border: '1px solid rgba(0, 0, 0, 0.06)',
                      borderRadius: '16px',
                      padding: '24px',
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'all 0.3s ease',
                      cursor: 'pointer',
                    }}
                    onClick={() => setViewerArticle(art)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-4px)'
                      e.currentTarget.style.boxShadow = '0 12px 30px rgba(212, 175, 55, 0.08)'
                      e.currentTarget.style.borderColor = 'rgba(212, 175, 55, 0.3)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.02)'
                      e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.06)'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <Tag color={cat.color} style={{ borderRadius: '8px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>
                          {cat.label}
                        </Tag>
                        {canWrite && (
                          <Space onClick={(e) => e.stopPropagation()}>
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined style={{ fontSize: '13px', color: '#1890ff' }} />}
                              onClick={() => {
                                setEditingArticle(art)
                                form.setFieldsValue(art)
                                setEditorOpen(true)
                              }}
                            />
                            {isSuper && (
                              <Popconfirm
                                title="Delete this guide?"
                                onConfirm={() => handleDelete(art.id)}
                                okText="Yes"
                                cancelText="No"
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined style={{ fontSize: '13px' }} />}
                                />
                              </Popconfirm>
                            )}
                          </Space>
                        )}
                      </div>
                      <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#141414', marginBottom: '8px', lineHeight: '1.4' }}>
                        {art.title}
                      </h4>
                      <p style={{ fontSize: '13px', color: '#595959', lineHeight: '1.6', marginBottom: '16px' }}>
                        {getPreviewText(art.content_md)}
                      </p>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(0, 0, 0, 0.04)', paddingTop: '12px', marginTop: 'auto' }}>
                      <span style={{ fontSize: '11px', color: '#8c8c8c' }}>
                        Updated {new Date(art.updated_at).toLocaleDateString()}
                      </span>
                      <span style={{ color: '#d4af37', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Read Guide <ArrowRightOutlined style={{ fontSize: '10px' }} />
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
"""

def improve():
    with open(support_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Replace icons import
    target_import = "import { MessageOutlined, PlusOutlined, BookOutlined } from '@ant-design/icons'"
    if target_import in content:
        content = content.replace(target_import, new_icons)
    else:
        print("Could not find standard ant-design icons import!")
        return

    # 2. Add helper functions inside KnowledgeBaseTab
    kb_tab_start = "function KnowledgeBaseTab() {"
    if kb_tab_start in content:
        content = content.replace(kb_tab_start, kb_tab_start + preview_text_func)
    else:
        print("Could not find KnowledgeBaseTab definition!")
        return

    # 3. Replace the return statement up to <Drawer
    old_return_start = "  return (\n    <div>\n      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>"
    old_return_end = "      <Drawer"
    
    start_idx = content.find(old_return_start)
    end_idx = content.find(old_return_end)
    
    if start_idx != -1 and end_idx != -1:
        old_block = content[start_idx:end_idx]
        content = content.replace(old_block, new_return_block + "\n")
        print("Replaced return block successfully!")
    else:
        # Fallback to loose matching if indentation/newlines differ slightly
        print(f"Could not find exact index block: start_idx={start_idx}, end_idx={end_idx}")
        return

    with open(support_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Improved KnowledgeBase UI in Support.tsx successfully!")

if __name__ == "__main__":
    improve()
