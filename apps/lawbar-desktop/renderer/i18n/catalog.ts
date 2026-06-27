// renderer/i18n/catalog.ts — zh-CN message catalog. Central source for all migrated UI strings.
// Per dev-memo/plan-i18n-00.md + dev-memo/plan-i18n-impl-00.md. v1 LOCALE = zh-CN (D1/D2).
//
// Stable string IDs → display text. Holds the enum-label entries (finite, used by the typed facade in
// ./labels.ts), shared keys, and per-screen UI strings (shell.* / list.* / detail.* / …) added as each
// surface migrates. Migrated surfaces resolve their user-facing text here via t() and/or the labels
// facade; the anti-drift guard's allowlist burns down as screens move their literals into this catalog.
//
// This file lives under renderer/i18n/ and is EXEMPT from the anti-drift guard's scan set (the guard
// scans renderer/screens/**, renderer/index.ts, renderer/index.html only). Its CJK values are the
// single source of truth the facade + t() resolve.

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

  // ---- shared keys ----
  "common.loadMore": "加载更多",

  // ---- shell chrome (WI-i18n-2; English -> zh-CN drift-closure per plan-i18n-00 §6.5) ----
  "shell.brand": "Lawbar · 案件盒",
  "shell.workspaceKind": "工作区",
  "shell.workspaceName": "本地",
  "shell.navMatters": "案件",
  "shell.navNewMatter": "新建案件",
  "shell.footerStatus": "本地优先",
  "shell.statusbarLabel": "案件盒",
  "shell.statusbarNote": "本地优先 · 文档仅存于本机",
  "shell.ariaPrimary": "主导航",
  "shell.ariaCaseBox": "案件盒",
  "shell.ariaApp": "案件盒",

  // ---- matter list route (WI-i18n-2; already zh-CN, moved to catalog) ----
  "list.title": "案件台账",
  "list.subtitle": "本机案件 · 按创建时间排列",
  "list.newMatter": "+ 新建案件",
  "list.tabsAria": "案件状态",
  "list.col.name": "案件名称",
  "list.col.type": "类型",
  "list.col.confidentiality": "保密级别",
  "list.col.created": "创建时间",
  "list.col.status": "状态",
  "list.empty.activeTitle": "暂无案件",
  "list.empty.activeBody": "点击「新建案件」创建第一个。案件数据仅保存在本机。",
  "list.empty.archived": "暂无已归档案件",
  "list.loading": "正在加载{status}案件…",

  // ---- matter detail MAIN route (WI-i18n-3; English -> zh-CN drift-closure) ----
  "detail.back": "← 返回案件列表",
  "detail.loading": "正在加载案件…",
  "detail.notFoundTitle": "未找到案件",
  "detail.invalidId": "案件编号无效或不存在。",
  "detail.unavailableTitle": "案件不可用",
  "detail.notFoundBody": "链接可能已失效。",
  "detail.locked": " (已锁定)",
  "detail.cardTitle": "案件信息",
  "detail.cardEyebrow": "§ 详情",
  "detail.matterIdSummary": "案件编号：{id}",
  "detail.field.matterType": "案件类型",
  "detail.field.jurisdiction": "管辖",
  "detail.field.confidentiality": "保密级别",
  "detail.field.created": "创建时间",
  "detail.field.archivedAt": "归档时间",
  "detail.field.archiveReason": "归档原因",
  "detail.field.retainerScope": "委托范围",
  "detail.field.caseType": "案由",
  "detail.field.caseProgress": "案件进展",
  "detail.field.courtContact": "法院联系人",
  "detail.field.contentionSummary": "争议焦点",
  "detail.field.parties": "当事人",
  "detail.archiveReasonRecorded": "原因记录于审计日志。",
  "detail.colophonTitle": "档案信息",
  "detail.colophonMatterId": "案件编号",
  "detail.dangerZone": "危险操作",
  "detail.archiveWarning": "归档将锁定本案件，操作记录于审计日志。",
  "detail.archiveButton": "归档…",
  "detail.archivedMarker": "本案件已归档。",

  // ---- Evidence links section (WI-A3-LINK-UI-T1) ----
  // resolver status (RendererLinkStatus) + the unlinked lifecycle marker.
  "linkStatus.valid": "有效",
  "linkStatus.needs_review": "待复核",
  "linkStatus.broken": "已失效",
  "linkStatus.unlinked": "已断开",
  // export-citation flags (RendererExportCitationFlag); CLEAN = a clean citation.
  "linkFlag.CLEAN": "可引用",
  "linkFlag.UNLINKED": "已断开",
  "linkFlag.BROKEN": "已失效",
  "linkFlag.NEEDS_REVIEW": "待复核",
  "linkFlag.NON_CITABLE": "不可引用",
  "linkFlag.AMBIGUOUS": "引用不明确",
  // section chrome
  "links.section.summary": "证据链接",
  "links.loading": "正在加载链接…",
  "links.load.failed": "无法加载链接，请重试。",
  "links.empty.title": "暂无证据链接",
  "links.empty.body": "使用上方的「创建链接」将证据、笔记或主张要素关联到锚点。",
  // row labels
  "links.row.created": "创建于",
  "links.row.unlinkedAt": "断开于",
  "links.row.reason": "原因",
  // create flow
  "links.create.sourceTypeLabel": "来源类型",
  "links.create.sourceIdLabel": "来源编号",
  "links.create.anchorIdLabel": "锚点编号",
  "links.create.button": "创建链接",
  "links.create.working": "处理中…",
  "links.create.success": "已创建。",
  "links.create.sourceIdRequired": "来源编号为必填项。",
  "links.create.anchorIdRequired": "锚点编号为必填项。",
  "links.create.failed": "无法创建链接，请重试。",
  // unlink flow (two-step, required reason)
  "links.unlink.button": "断开",
  "links.unlink.reasonLabel": "断开原因",
  "links.unlink.confirm": "确认断开",
  "links.unlink.warning": "断开将使该引用失效，并记录于审计日志。",
  "links.unlink.reasonRequired": "断开原因为必填项。",
  "links.unlink.working": "处理中…",
  "links.unlink.success": "已断开。",
  "links.unlink.failed": "无法断开链接，请重试。",
  // relink flow (one-click, no reason)
  "links.relink.button": "恢复",
  "links.relink.working": "处理中…",
  "links.relink.success": "已恢复。",
  "links.relink.failed": "无法恢复链接，请重试。",
  // export-citations panel
  "links.export.button": "导出引用",
  "links.export.working": "正在生成引用…",
  "links.export.title": "引用清单",
  "links.export.empty": "暂无可导出的引用。",
  "links.export.failed": "无法生成引用，请重试。",
  "links.export.summaryLabel": "按分类汇总",
} as const;

export type CatalogId = keyof typeof CATALOG;
