import { useState, useEffect } from 'react'
import { Input, Button, Card, Tag, Space, Spin, Result, Empty, Divider } from 'antd'
import { SendOutlined, CopyOutlined, ClearOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

interface Message {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: string
}

export function AIPromptConsole() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Load chat history from localStorage
    const saved = localStorage.getItem('aiPromptHistory')
    if (saved) {
      setMessages(JSON.parse(saved))
    }
  }, [])

  const saveHistory = (msgs: Message[]) => {
    localStorage.setItem('aiPromptHistory', JSON.stringify(msgs.slice(-20))) // Keep last 20
  }

  const handleSend = async () => {
    if (!input.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const response = await adminApi.post('ml/query', {
        query: input,
      })

      if (response.data.success) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: response.data.data.answer || 'No response',
          timestamp: new Date().toISOString(),
        }

        const updated = [...messages, userMessage, assistantMessage]
        setMessages(updated)
        saveHistory(updated)
      } else {
        setError(response.data.error || 'Failed to get response')
        setMessages((prev) => [...prev, userMessage])
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with AI service')
      setMessages((prev) => [...prev, userMessage])
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setMessages([])
    setError(null)
    localStorage.removeItem('aiPromptHistory')
  }

  const exampleQueries = [
    'show recent fraud alerts from last 24 hours',
    'analyze fraud detection rule effectiveness',
    'which players are flagged for co-location',
    'explain unusual win rate for player_id=xyz',
    'analyze churn for stake=100 users',
    'fraud alert: show evidence for player X',
    'explain bot decision for player_id=abc',
    'compare churn model accuracy week-over-week',
    'what is the average session length',
    'show me top 10 at-risk players',
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Example Queries */}
      {messages.length === 0 && (
        <Card
          size="small"
          style={{ marginBottom: 16, backgroundColor: '#fafafa' }}
          title="Example Queries"
        >
          <Space wrap>
            {exampleQueries.map((query) => (
              <Tag
                key={query}
                color="blue"
                style={{ cursor: 'pointer', padding: '6px 12px' }}
                onClick={() => {
                  setInput(query)
                }}
              >
                {query}
              </Tag>
            ))}
          </Space>
        </Card>
      )}

      {/* Chat History */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          marginBottom: 16,
          padding: 12,
          backgroundColor: '#fafafa',
          borderRadius: 4,
          minHeight: 300,
        }}
      >
        {messages.length === 0 ? (
          <Empty description="Start by asking a question about your platform data" />
        ) : (
          <div>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  marginBottom: 16,
                  textAlign: msg.type === 'user' ? 'right' : 'left',
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    maxWidth: '70%',
                    padding: '12px 16px',
                    borderRadius: 8,
                    backgroundColor:
                      msg.type === 'user' ? '#1890ff' : '#fff',
                    color: msg.type === 'user' ? '#fff' : '#000',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  }}
                >
                  <div>{msg.content}</div>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      marginTop: 4,
                    }}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Spin />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <Result
          status="error"
          title="Error"
          subTitle={error}
          style={{ padding: 16, marginBottom: 16 }}
        />
      )}

      {/* Input Area */}
      <Card
        size="small"
        title="Send Query"
        extra={
          messages.length > 0 && (
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClear}
            >
              Clear
            </Button>
          )
        }
      >
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="Ask about churn, fraud, bot behavior, revenue, etc."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={handleSend}
            disabled={loading}
            style={{ borderRadius: '4px 0 0 4px' }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={loading}
            style={{ borderRadius: '0 4px 4px 0' }}
          >
            Send
          </Button>
        </Space.Compact>
      </Card>

      <Divider style={{ margin: '16px 0' }} />

      <Card size="small" title="Info">
        <p style={{ fontSize: 12, margin: 0 }}>
          ðŸ’¡ Ask questions in natural language. The AI will analyze your platform data
          and provide insights, explain predictions, and help debug issues.
        </p>
      </Card>
    </div>
  )
}

