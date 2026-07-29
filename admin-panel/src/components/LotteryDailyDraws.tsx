import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Select, DatePicker, Input, Space, message, Drawer,
  Tag, Popconfirm, InputNumber
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminApi } from '../api/client';
import dayjs, { Dayjs } from 'dayjs';

interface LotteryDailyDrawsProps {
  onRefresh: () => void;
}

interface Draw {
  id: string;
  tier_id: string;
  draw_date: string;
  draw_time: string;
  status: 'open' | 'calling' | 'settled' | 'cancelled';
  winning_number: string | null;
  prize_tiers: PrizeTier[];
  created_at: string;
  tickets_count?: number;
}

interface Tier {
  id: string;
  amount: number;
  draw_time: string;
  default_prize_tiers: PrizeTier[];
  status: string;
}

interface PrizeTier {
  match_type: 'last_1' | 'last_2' | 'last_3' | 'exact';
  outcome_type: 'cash' | 'coupon';
  multiplier?: number;
  coupon_code?: string;
}

interface Ticket {
  id: string;
  ticket_number: string;
  user_id: string;
  match_type: string | null;
  outcome_type: 'cash' | 'coupon' | 'none';
  prize: number | null;
  created_at: string;
}

export default function LotteryDailyDraws({ onRefresh }: LotteryDailyDrawsProps) {
  const [draws, setDraws] = useState<Draw[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [ticketsDrawerOpen, setTicketsDrawerOpen] = useState(false);
  const [declareModalOpen, setDeclareModalOpen] = useState(false);
  const [selectedDraw, setSelectedDraw] = useState<Draw | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [declareForm] = Form.useForm();

  useEffect(() => {
    loadDraws();
    loadTiers();
  }, []);

  const loadDraws = async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/betting/lottery/daily/admin/draws');
      setDraws(res.data.draws || []);
    } catch (err) {
      message.error('Failed to load draws');
    } finally {
      setLoading(false);
    }
  };

  const loadTiers = async () => {
    try {
      const res = await adminApi.get('/betting/lottery/daily/admin/tiers');
      setTiers(res.data.tiers || []);
    } catch (err) {
      // Silently fail
    }
  };

  const loadTickets = async (drawId: string) => {
    setTicketsLoading(true);
    try {
      const res = await adminApi.get(`/betting/lottery/daily/admin/draws/${drawId}/tickets`);
      setTickets(res.data.tickets || []);
    } catch (err) {
      message.error('Failed to load tickets');
      setTickets([]);
    } finally {
      setTicketsLoading(false);
    }
  };

  const handleCreate = () => {
    createForm.resetFields();
    setCreateModalOpen(true);
  };

  const handleCreateDraw = async (values: any) => {
    try {
      const tier = tiers.find(t => t.id === values.tier_id);
      if (!tier) {
        message.error('Tier not found');
        return;
      }

      await adminApi.post('/betting/lottery/daily/admin/draws', {
        tier_id: values.tier_id,
        draw_date: values.draw_date.format('YYYY-MM-DD'),
        prize_tiers: values.prize_tiers || tier.default_prize_tiers
      });

      message.success('Draw created');
      setCreateModalOpen(false);
      loadDraws();
      onRefresh();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Failed to create draw');
    }
  };

  const handleDeclareResult = async (values: any) => {
    if (!selectedDraw) return;

    try {
      await adminApi.post(`/betting/lottery/daily/admin/draws/${selectedDraw.id}/declare`, {
        winning_number: values.winning_number
      });

      message.success('Result declared and settlement initiated');
      setDeclareModalOpen(false);
      loadDraws();
      onRefresh();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Failed to declare result');
    }
  };

  const handleCancel = (drawId: string) => {
    Modal.confirm({
      title: 'Cancel Draw',
      content: 'All tickets will be refunded. This action cannot be undone. Continue?',
      okText: 'Cancel Draw',
      okType: 'danger',
      onOk: async () => {
        try {
          await adminApi.post(`/betting/lottery/daily/admin/draws/${drawId}/cancel`);
          message.success('Draw cancelled and tickets refunded');
          loadDraws();
          onRefresh();
        } catch (err: any) {
          message.error(err?.response?.data?.error || 'Failed to cancel draw');
        }
      }
    });
  };

  const handleShowTickets = (draw: Draw) => {
    setSelectedDraw(draw);
    setTicketsDrawerOpen(true);
    loadTickets(draw.id);
  };

  const handleShowDeclareModal = (draw: Draw) => {
    setSelectedDraw(draw);
    declareForm.resetFields();
    setDeclareModalOpen(true);
  };

  const generateRandomNumber = () => {
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    declareForm.setFieldValue('winning_number', random);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'blue';
      case 'calling': return 'orange';
      case 'settled': return 'green';
      case 'cancelled': return 'red';
      default: return 'default';
    }
  };

  const columns = [
    {
      title: 'Tier (₹)',
      dataIndex: 'tier_id',
      key: 'tier_id',
      render: (tierId: string) => {
        const tier = tiers.find(t => t.id === tierId);
        return tier ? `₹${tier.amount}` : tierId;
      }
    },
    {
      title: 'Date',
      dataIndex: 'draw_date',
      key: 'draw_date',
      render: (date: string) => date ? new Date(date).toLocaleDateString() : '—'
    },
    {
      title: 'Time',
      dataIndex: 'draw_time',
      key: 'draw_time',
      render: (time: string) => time ? new Date(time).toLocaleTimeString() : '—'
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => <Tag color={getStatusColor(status)}>{status.toUpperCase()}</Tag>
    },
    {
      title: 'Winning #',
      dataIndex: 'winning_number',
      key: 'winning_number',
      render: (num: string | null) => num ? <strong>{num}</strong> : '—'
    },
    {
      title: 'Tickets',
      dataIndex: 'tickets_count',
      key: 'tickets_count',
      render: (count: number) => count || 0
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Draw) => (
        <Space size="small">
          <Button
            size="small"
            onClick={() => handleShowTickets(record)}
          >
            Tickets
          </Button>
          {record.status === 'open' && (
            <Button
              type="primary"
              size="small"
              onClick={() => handleShowDeclareModal(record)}
            >
              Declare
            </Button>
          )}
          {record.status !== 'settled' && record.status !== 'cancelled' && (
            <Popconfirm
              title="Cancel Draw"
              description="All tickets will be refunded. Continue?"
              onConfirm={() => handleCancel(record.id)}
              okText="Yes"
              cancelText="No"
              okButtonProps={{ danger: true }}
            >
              <Button danger size="small">
                Cancel
              </Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleCreate}
        >
          Create Draw
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={loadDraws}
        >
          Refresh
        </Button>
      </Space>

      <Table
        rowKey="id"
        dataSource={draws}
        columns={columns}
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: 1200 }}
      />

      {/* Create Draw Modal */}
      <Modal
        title="Create Draw"
        open={createModalOpen}
        onOk={() => createForm.submit()}
        onCancel={() => setCreateModalOpen(false)}
        width={600}
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={handleCreateDraw}
        >
          <Form.Item
            label="Tier"
            name="tier_id"
            rules={[{ required: true, message: 'Please select a tier' }]}
          >
            <Select
              placeholder="Select tier"
              options={tiers.map(t => ({
                label: `${t.amount}₹ (Draw time: ${t.draw_time})`,
                value: t.id
              }))}
            />
          </Form.Item>

          <Form.Item
            label="Draw Date"
            name="draw_date"
            initialValue={dayjs()}
            rules={[{ required: true, message: 'Please select draw date' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label="Prize Tiers (Optional - leave blank to use tier defaults)"
            name="prize_tiers"
          >
            <PrizeTiersList />
          </Form.Item>
        </Form>
      </Modal>

      {/* Declare Result Modal */}
      <Modal
        title={`Declare Result — Draw ${selectedDraw?.id?.slice(0, 8)}...`}
        open={declareModalOpen}
        onOk={() => declareForm.submit()}
        onCancel={() => setDeclareModalOpen(false)}
      >
        <Form
          form={declareForm}
          layout="vertical"
          onFinish={handleDeclareResult}
        >
          <Form.Item
            label="Winning Number (4 digits)"
            name="winning_number"
            rules={[
              { required: true, message: 'Required' },
              {
                pattern: /^\d{4}$/,
                message: 'Must be exactly 4 digits'
              }
            ]}
          >
            <Input
              placeholder="0000"
              maxLength={4}
              type="text"
              inputMode="numeric"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="dashed"
              block
              onClick={generateRandomNumber}
            >
              🎲 Auto-Generate Random Number
            </Button>
          </Form.Item>

          <p style={{ color: '#666', fontSize: 12, marginTop: 16 }}>
            Once declared, the system will match all tickets to this number and settle payouts.
            This action cannot be undone.
          </p>
        </Form>
      </Modal>

      {/* Tickets Drawer */}
      <Drawer
        title={`Tickets — Draw ${selectedDraw?.id?.slice(0, 8)}...`}
        onClose={() => setTicketsDrawerOpen(false)}
        open={ticketsDrawerOpen}
        width={600}
      >
        {ticketsLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p>Loading tickets...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p>No tickets for this draw</p>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <div><strong>Total Tickets:</strong> {tickets.length}</div>
              <div><strong>Winners (Cash):</strong> {tickets.filter(t => t.outcome_type === 'cash').length}</div>
              <div><strong>Winners (Coupon):</strong> {tickets.filter(t => t.outcome_type === 'coupon').length}</div>
            </div>

            <Table
              rowKey="id"
              dataSource={tickets}
              columns={[
                {
                  title: 'Ticket #',
                  dataIndex: 'ticket_number',
                  key: 'ticket_number',
                  render: (num: string) => <strong>{num}</strong>
                },
                {
                  title: 'Match Type',
                  dataIndex: 'match_type',
                  key: 'match_type',
                  render: (type: string | null) => type ? <Tag>{type}</Tag> : '—'
                },
                {
                  title: 'Outcome',
                  dataIndex: 'outcome_type',
                  key: 'outcome_type',
                  render: (type: string) => {
                    const colorMap = {
                      cash: 'green',
                      coupon: 'orange',
                      none: 'default'
                    };
                    return <Tag color={colorMap[type as keyof typeof colorMap]}>{type.toUpperCase()}</Tag>;
                  }
                },
                {
                  title: 'Prize',
                  dataIndex: 'prize',
                  key: 'prize',
                  render: (prize: number | null) => prize ? `₹${prize}` : '—'
                }
              ]}
              size="small"
              pagination={{ pageSize: 10 }}
              scroll={{ x: 500 }}
            />
          </div>
        )}
      </Drawer>
    </>
  );
}

/**
 * Prize Tiers List Editor Component
 * Allows adding/editing prize tier configurations
 */
function PrizeTiersList({ value, onChange }: { value?: PrizeTier[]; onChange?: (tiers: PrizeTier[]) => void }) {
  const tiers = value || [];
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm] = Form.useForm();

  const handleAddTier = () => {
    setEditingIndex(tiers.length);
    editForm.resetFields();
  };

  const handleSaveTier = (values: any) => {
    if (editingIndex !== null) {
      const newTiers = [...tiers];
      newTiers[editingIndex] = values;
      onChange?.(newTiers);
      setEditingIndex(null);
    }
  };

  const handleDeleteTier = (index: number) => {
    onChange?.(tiers.filter((_, i) => i !== index));
  };

  return (
    <div>
      {tiers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {tiers.map((tier, idx) => (
            <div
              key={idx}
              style={{
                padding: 12,
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <strong>{tier.match_type}</strong>: {tier.outcome_type === 'cash' ? `${tier.multiplier}x` : tier.coupon_code}
              </div>
              <Space>
                <Button size="small" onClick={() => setEditingIndex(idx)}>Edit</Button>
                <Button size="small" danger onClick={() => handleDeleteTier(idx)}>Delete</Button>
              </Space>
            </div>
          ))}
        </div>
      )}

      {editingIndex === null && (
        <Button
          type="dashed"
          block
          onClick={handleAddTier}
        >
          + Add Prize Tier
        </Button>
      )}

      {editingIndex !== null && (
        <Form
          form={editForm}
          layout="vertical"
          initialValues={editingIndex < tiers.length ? tiers[editingIndex] : {}}
          onFinish={handleSaveTier}
          style={{
            padding: 12,
            border: '1px solid #1890ff',
            borderRadius: 4,
            marginBottom: 8,
            backgroundColor: '#f0f5ff'
          }}
        >
          <Form.Item
            label="Match Type"
            name="match_type"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { label: 'Exact Match (4/4)', value: 'exact' },
                { label: 'Last 3 Digits', value: 'last_3' },
                { label: 'Last 2 Digits', value: 'last_2' },
                { label: 'Last 1 Digit', value: 'last_1' }
              ]}
            />
          </Form.Item>

          <Form.Item
            label="Outcome Type"
            name="outcome_type"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { label: 'Cash Payout', value: 'cash' },
                { label: 'Coupon', value: 'coupon' }
              ]}
            />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prevValues, currentValues) =>
            prevValues.outcome_type !== currentValues.outcome_type
          }>
            {({ getFieldValue }) =>
              getFieldValue('outcome_type') === 'cash' ? (
                <Form.Item
                  label="Multiplier"
                  name="multiplier"
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    placeholder="e.g., 50"
                    min={1}
                  />
                </Form.Item>
              ) : (
                <Form.Item
                  label="Coupon Code"
                  name="coupon_code"
                  rules={[{ required: true }]}
                >
                  <Input placeholder="e.g., SUMMER50" />
                </Form.Item>
              )
            }
          </Form.Item>

          <Space>
            <Button type="primary" htmlType="submit">
              Save
            </Button>
            <Button onClick={() => setEditingIndex(null)}>
              Cancel
            </Button>
          </Space>
        </Form>
      )}
    </div>
  );
}
