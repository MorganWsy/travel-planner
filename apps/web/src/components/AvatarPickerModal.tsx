import { useEffect, useMemo, useState } from "react";
import { Avatar, Button } from "antd";
import DragModal from "./DragModal";
import { ReloadOutlined } from "@ant-design/icons";
import { AVATAR_FILES, avatarUrl } from "../lib/avatars";

interface Props {
  open: boolean;
  current: string | null | undefined;
  busy?: boolean;
  onPick: (name: string) => void;
  onCancel: () => void;
}

/** 一次展示 24 张，避免 424 张全画出来卡顿 */
const PAGE = 24;

/**
 * 头像选择：从预设库里分页随机取一批，点选即保存。
 *
 * 当前头像不在这一批时置顶单独显示，否则用户会以为「我现在的头像没了」。
 */
export default function AvatarPickerModal({ open, current, busy = false, onPick, onCancel }: Props) {
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (open) setSeed(Math.floor(Math.random() * 1000));
  }, [open]);

  const batch = useMemo(() => {
    // 用固定步长从全量里抽一批：既覆盖不同风格，又不会每次都一样
    const start = (seed * PAGE) % AVATAR_FILES.length;
    const picked: string[] = [];
    for (let i = 0; i < PAGE; i += 1) {
      picked.push(AVATAR_FILES[(start + i * 7) % AVATAR_FILES.length]);
    }
    if (current && !picked.includes(current)) picked.unshift(current);
    return picked;
  }, [seed, current]);

  return (
    <DragModal
      centered
      title="切换头像"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={520}
      destroyOnHidden
    >
      <div className="avatar-picker">
        <div className="avatar-grid">
          {batch.map((name) => (
            <button
              type="button"
              key={name}
              className={`avatar-cell${current === name ? " selected" : ""}`}
              disabled={busy}
              aria-label="选择这个头像"
              onClick={() => onPick(name)}
            >
              <Avatar size={52} src={avatarUrl(name)} shape="square" />
            </button>
          ))}
        </div>
        <div className="avatar-picker-foot">
          <span />
          <Button size="small" icon={<ReloadOutlined />} onClick={() => setSeed((value) => value + 1)}>
            换一批
          </Button>
        </div>
      </div>
    </DragModal>
  );
}
