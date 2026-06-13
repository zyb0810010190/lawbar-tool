// renderer/i18n/catalog.ts — zh-CN message catalog (WI-i18n-1, infra-only).
// Per dev-memo/plan-i18n-00.md + dev-memo/plan-i18n-impl-00.md. v1 LOCALE = zh-CN (D1/D2).
//
// Stable string IDs → display text. This WI seeds ONLY the enum-label entries (finite, needed by the
// typed facade in ./labels.ts) plus a small set of shared keys used to exercise t(). Per-screen
// free-text chrome keys are added by the later screen-migration WIs; NO screen consumes this catalog
// yet (it is unwired — see plan §6/§6A).
//
// This file lives under renderer/i18n/ and is EXEMPT from the anti-drift guard's scan set (the guard
// scans renderer/screens/**, renderer/index.ts, renderer/index.html only). Its CJK values are the
// single source of truth the facade resolves through t().

export const CATALOG = {
  // ---- enum: matter type (renderer/types.ts MatterType) ----
  "matterType.litigation": "诉讼",
  "matterType.arbitration": "仲裁",
  "matterType.advisory": "顾问",
  "matterType.due_diligence": "尽职调查",
  "matterType.criminal_defense": "刑事辩护",
  "matterType.other": "其他",

  // ---- enum: confidentiality class (ConfidentialityClass) ----
  "confidentiality.normal": "普通",
  "confidentiality.heightened": "加强",
  "confidentiality.sealed": "密封",

  // ---- enum: matter status (MatterStatus) ----
  "status.active": "进行中",
  "status.archived": "已归档",

  // ---- enum: deadline urgency (DeadlineUrgency); "none" is intentionally empty ----
  "deadlineUrgency.overdue": "逾期",
  "deadlineUrgency.due-soon": "即将到期",
  "deadlineUrgency.none": "",

  // ---- enum: derived ledger category (LedgerCategory) ----
  "ledgerCategory.litigation": "诉讼",
  "ledgerCategory.counsel": "顾问",
  "ledgerCategory.non_litigation": "非诉讼",

  // ---- enum: audit event kind (case-box-contract CaseBoxAuditEventKind) ----
  "eventKind.MATTER_REGISTERED": "案件已创建",
  "eventKind.MATTER_ARCHIVED": "案件已归档",
  "eventKind.MATTER_UNARCHIVED": "案件已取消归档",
  "eventKind.DOCUMENT_REGISTERED": "文档已登记",
  "eventKind.DOCUMENT_OCR_SUBMITTED": "文档 OCR 已提交",
  "eventKind.DOCUMENT_OCR_COMPLETE": "文档 OCR 已完成",
  "eventKind.DOCUMENT_OCR_FAILED": "文档 OCR 失败",
  "eventKind.DOCUMENT_TRIAGED": "文档已分拣",
  "eventKind.DOCUMENT_TAGGED": "文档已标记",
  "eventKind.DOCUMENT_REVIEWED": "文档已审阅",
  "eventKind.DOCUMENT_SOFT_DELETED": "文档已删除",
  "eventKind.OCR_LINK_SNAPSHOTTED": "OCR 链接已快照",
  "eventKind.OCR_LINK_REFRESHED": "OCR 链接已刷新",
  "eventKind.DEADLINE_REGISTERED": "期限已登记",
  "eventKind.DEADLINE_MET": "期限已标记完成",
  "eventKind.DEADLINE_MISSED": "期限已标记错过",
  "eventKind.DEADLINE_WITHDRAWN": "期限已撤回",
  "eventKind.DEADLINE_MISSED_TO_MET": "错过的期限已标记完成",
  "eventKind.EVIDENCE_PROPOSED": "证据已提议",
  "eventKind.EVIDENCE_ACCEPTED": "证据已采纳",
  "eventKind.EVIDENCE_REJECTED": "证据已驳回",
  "eventKind.EVIDENCE_SUPERSEDED": "证据已被替代",
  "eventKind.FACT_PROPOSED": "事实已提议",
  "eventKind.FACT_REVIEWED": "事实已审阅",
  "eventKind.FACT_ACCEPTED": "事实已采纳",
  "eventKind.FACT_REJECTED": "事实已驳回",
  "eventKind.FACT_REPLACEMENT_ACCEPTED": "替换事实已采纳",
  "eventKind.PRIVILEGE_MARKER_PROPOSED": "特权标记已提议",
  "eventKind.PRIVILEGE_MARKER_CONFIRMED": "特权标记已确认",
  "eventKind.PRIVILEGE_MARKER_DISMISSED": "特权标记已驳回",
  "eventKind.PRIVILEGE_MARKER_WAIVED": "特权已放弃",
  "eventKind.EXTERNAL_OCR_AUTHORIZED": "外部 OCR 已授权",
  "eventKind.EXTERNAL_OCR_REVOKED": "外部 OCR 已撤销",
  "eventKind.SYNC_GRANT_GRANTED": "同步授权已授予",
  "eventKind.SYNC_GRANT_REVOKED": "同步授权已撤销",
  "eventKind.LLM_EXTRACTION_OPT_IN": "已开启 LLM 抽取",
  "eventKind.LLM_EXTRACTION_OPT_OUT": "已关闭 LLM 抽取",
  "eventKind.PRIVILEGE_LOG_EXPORTED": "特权日志已导出",
  "eventKind.CASE_DATA_EXPORTED": "案件数据已导出",
  "eventKind.DOCUMENT_ACCESSED": "文档已访问",
  "eventKind.DOCUMENT_PRINTED": "文档已打印",
  "eventKind.DOCUMENT_SHARED": "文档已共享",
  "eventKind.CLASSIFICATION_SET": "保密级别已设置",
  "eventKind.CLASSIFICATION_UPGRADED": "保密级别已上调",
  "eventKind.CLASSIFICATION_DOWNGRADED": "保密级别已下调",
  "eventKind.CLASSIFICATION_RESET_TO_UNCLASSIFIED": "保密级别已重置为未分类",
  "eventKind.DOCKET_ENTRY_PROPOSED": "立案条目已提议",
  "eventKind.DOCKET_ENTRY_CONFIRMED": "立案条目已确认",
  "eventKind.DOCKET_ENTRY_DISMISSED": "立案条目已驳回",
  "eventKind.DOCKET_ENTRY_REVISED": "立案条目已修订",

  // ---- shared keys (exercise t(); also real future keys) ----
  "common.loadMore": "加载更多",
  "list.loading": "正在加载{status}案件…",
} as const;

export type CatalogId = keyof typeof CATALOG;
