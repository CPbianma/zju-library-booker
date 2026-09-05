import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

import type { BookingPreview } from '../../../shared/contracts';

interface PreviewModalProps {
  preview: BookingPreview;
  onClose(): void;
}

export function PreviewModal({ preview, onClose }: PreviewModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="preview-title"
        aria-modal="true"
        className="preview-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="modal-close-button" onClick={onClose} type="button" aria-label="关闭预览">
          <X size={20} />
        </button>
        <div className="modal-icon"><CheckCircle2 size={25} /></div>
        <h2 id="preview-title">预约信息预览</h2>
        <p className="modal-subtitle">请核对以下信息。本版本不会向图书馆提交预约。</p>

        <dl className="preview-details">
          <div><dt>类型</dt><dd>{preview.typeLabel}</dd></div>
          <div><dt>地点</dt><dd>{preview.location} · {preview.candidateName}</dd></div>
          <div><dt>日期</dt><dd>{preview.date}</dd></div>
          <div><dt>实际时间</dt><dd>{preview.timeRange}</dd></div>
          {preview.title && <div><dt>申请标题</dt><dd>{preview.title}</dd></div>}
          {preview.content && <div><dt>申请用途</dt><dd>{preview.content}</dd></div>}
          {preview.maskedMobile && <div><dt>联系电话</dt><dd>{preview.maskedMobile}</dd></div>}
          {preview.participantCount !== undefined && (
            <div><dt>参与人数</dt><dd>{preview.participantCount} 人</dd></div>
          )}
        </dl>

        <div className="preview-warning">
          <AlertTriangle size={18} />
          <div>{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">返回修改</button>
          <button className="disabled-submit-button" disabled type="button">提交功能尚未接入</button>
        </div>
      </section>
    </div>
  );
}
