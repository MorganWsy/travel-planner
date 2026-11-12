import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Dropdown, Empty, Form, Input, Spin, Typography } from "antd";
import DragModal from "../components/DragModal";
import { PlusOutlined } from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../api/api";
import { errorText } from "../api/client";
import { notify } from "../lib/notify";
import TopBar from "../components/TopBar";

export default function TripsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ title: string; range: [Dayjs, Dayjs] }>();

  const trips = useQuery({ queryKey: ["trips"], queryFn: api.listTrips });

  const create = useMutation({
    mutationFn: (values: { title: string; range: [Dayjs, Dayjs] }) =>
      api.createTrip({
        title: values.title,
        start_date: values.range[0].format("YYYY-MM-DD"),
        end_date: values.range[1].format("YYYY-MM-DD"),
      }),
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      setOpen(false);
      form.resetFields();
      navigate(`/trips/${trip.id}`);
    },
    onError: (error) => notify.error(errorText(error)),
  });

  const remove = useMutation({
    mutationFn: (tripId: string) => api.deleteTrip(tripId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      notify.success("行程已删除");
    },
    onError: (error) => notify.error(errorText(error)),
  });

  const clone = useMutation({
    mutationFn: (tripId: string) => api.cloneTrip(tripId),
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      navigate(`/trips/${trip.id}`);
    },
    onError: (error) => notify.error(errorText(error)),
  });

  return (
    <div className="workspace">
      <TopBar actions={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建行程</Button>} />

      <div className="page-wrap">
        <div className="page">
          <div className="page-header">
            <Typography.Title level={5} style={{ margin: 0 }}>
              我的行程
            </Typography.Title>
            <span className="spacer" style={{ flex: 1 }} />
          </div>

          {trips.isLoading ? (
            <div className="centered" style={{ height: 200 }}>
              <Spin />
            </div>
          ) : trips.data && trips.data.length > 0 ? (
            <div className="trip-grid">
              {trips.data.map((trip) => (
                <div key={trip.id} className="trip-card" onClick={() => navigate(`/trips/${trip.id}`)}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <h3 style={{ flex: 1 }}>{trip.title}</h3>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          { key: "clone", label: "复制行程" },
                          { key: "delete", label: <span style={{ color: "#cf1322" }}>删除</span> },
                        ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === "clone") clone.mutate(trip.id);
                          if (key === "delete") remove.mutate(trip.id);
                        },
                      }}
                    >
                      <Button size="small" type="text" onClick={(event) => event.stopPropagation()}>
                        ···
                      </Button>
                    </Dropdown>
                  </div>
                  <div className="muted tiny">
                    {trip.start_date} → {trip.end_date} · {trip.day_count} 天 · {trip.stop_count} 个事项
                  </div>
                  <div className="muted tiny" style={{ marginTop: 6 }}>
                    更新于 {dayjs(trip.updated_at).format("MM-DD HH:mm")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="还没有行程" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" size="small" onClick={() => setOpen(true)}>
                创建第一个行程
              </Button>
            </Empty>
          )}

        </div>
      </div>

      <DragModal centered
        title="新建行程"
        open={open}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="ok" type="primary" loading={create.isPending} onClick={() => form.submit()}>
            创建
          </Button>,
        ]}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ range: [dayjs(), dayjs().add(2, "day")] }}
          onFinish={(values) => create.mutate(values)}
        >
          <Form.Item name="title" label="标题" rules={[{ required: true, max: 120 }]}>
            <Input placeholder="例如：杭州三日" />
          </Form.Item>
          <Form.Item name="range" label="日期范围" rules={[{ required: true }]}>
            <DatePicker.RangePicker style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </DragModal>
    </div>
  );
}
