const PptxGenJS = require('pptxgenjs');
const path = require('path');

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 16:9, 33.87 x 19.05 cm

// ── Shared design tokens ──────────────────────────────────────────────────
const DARK_BLUE  = '002B5C';
const MED_BLUE   = '1464A5';
const LIGHT_BG   = 'DDEAF6';
const WHITE      = 'FFFFFF';
const TEXT_DARK  = '1D2D3E';
const TEXT_SUB   = '3A4D5C';
const BORDER_CLR = 'B2CCE0';

const W = 33.867; // slide width  (cm)
const H = 19.05;  // slide height (cm)

// ── Helper: draw top bar ──────────────────────────────────────────────────
function addTopBar(slide) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 1.5,
    fill: { color: DARK_BLUE },
    line: { color: DARK_BLUE }
  });
  // SAP label (simulate logo text)
  slide.addText('SAP', {
    x: W - 3.2, y: 0.15, w: 2.8, h: 1.2,
    fontSize: 22, bold: true, color: WHITE,
    align: 'right', fontFace: 'Arial'
  });
  // Chevron shape
  slide.addShape(pptx.ShapeType.rightArrow, {
    x: W - 0.8, y: 0.3, w: 0.65, h: 0.9,
    fill: { color: '00A0DA' },
    line: { color: '00A0DA' }
  });
}

// ── Helper: draw badge ────────────────────────────────────────────────────
function addBadge(slide, text) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 1.3, y: 1.7, w: 4.2, h: 0.55,
    fill: { color: MED_BLUE },
    line: { color: MED_BLUE }
  });
  slide.addText(text, {
    x: 1.3, y: 1.7, w: 4.2, h: 0.55,
    fontSize: 12, bold: true, color: WHITE,
    align: 'center', valign: 'middle', fontFace: 'Arial'
  });
}

// ── Helper: slide title with underline ───────────────────────────────────
function addTitle(slide, text) {
  slide.addText(text, {
    x: 1.3, y: 2.4, w: W - 2.8, h: 1.1,
    fontSize: 28, bold: true, color: DARK_BLUE,
    fontFace: 'Arial', valign: 'bottom'
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 1.3, y: 3.5, w: W - 2.8, h: 0,
    line: { color: MED_BLUE, width: 2.5 }
  });
}

// ── Helper: panel box ─────────────────────────────────────────────────────
function addPanel(slide, x, y, w, h) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: LIGHT_BG },
    line: { color: LIGHT_BG }
  });
  // left accent border
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w: 0.13, h,
    fill: { color: MED_BLUE },
    line: { color: MED_BLUE }
  });
}

// ── Helper: panel title ───────────────────────────────────────────────────
function addPanelTitle(slide, text, x, y, w) {
  slide.addText(text, {
    x: x + 0.22, y, w: w - 0.3, h: 0.6,
    fontSize: 14, bold: true, color: DARK_BLUE, fontFace: 'Arial'
  });
}

// ── Helper: blue square bullet ────────────────────────────────────────────
function addBullet(slide, text, x, y, w, opts = {}) {
  // square
  slide.addShape(pptx.ShapeType.rect, {
    x, y: y + 0.07, w: 0.22, h: 0.22,
    fill: { color: MED_BLUE },
    line: { color: MED_BLUE }
  });
  slide.addText(text, {
    x: x + 0.33, y, w: w - 0.35, h: opts.h || 0.55,
    fontSize: opts.fontSize || 12, color: opts.color || TEXT_DARK,
    fontFace: 'Arial', wrap: true, valign: 'top',
    bold: opts.bold || false
  });
}

// ── Helper: tag bar ───────────────────────────────────────────────────────
function addTags(slide, labels, x, y) {
  let cx = x;
  labels.forEach(label => {
    const w = label.length * 0.19 + 0.5;
    slide.addShape(pptx.ShapeType.rect, {
      x: cx, y, w, h: 0.44,
      fill: { color: DARK_BLUE },
      line: { color: DARK_BLUE }
    });
    slide.addText(label, {
      x: cx, y, w, h: 0.44,
      fontSize: 10, bold: true, color: WHITE,
      align: 'center', valign: 'middle', fontFace: 'Arial'
    });
    cx += w + 0.18;
  });
}

// ── Helper: footer ────────────────────────────────────────────────────────
function addFooter(slide) {
  slide.addText('Clean Core AI 知识问答助手', {
    x: 1.3, y: H - 0.55, w: 10, h: 0.45,
    fontSize: 11, color: '888888', fontFace: 'Arial'
  });
}

// ── Helper: step circle ───────────────────────────────────────────────────
function addStep(slide, num, text, x, y, w) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x, y: y + 0.03, w: 0.38, h: 0.38,
    fill: { color: MED_BLUE },
    line: { color: MED_BLUE }
  });
  slide.addText(String(num), {
    x, y: y + 0.03, w: 0.38, h: 0.38,
    fontSize: 10, bold: true, color: WHITE,
    align: 'center', valign: 'middle', fontFace: 'Arial'
  });
  slide.addText(text, {
    x: x + 0.48, y, w, h: 0.44,
    fontSize: 11, color: TEXT_DARK, fontFace: 'Arial', wrap: true
  });
}


// ════════════════════════════════════════════════════════════════════════
// SLIDE 1 — BTP 知识库：功能概览
// ════════════════════════════════════════════════════════════════════════
{
  const slide = pptx.addSlide();
  addTopBar(slide);
  addBadge(slide, '核心功能 07 / 10');
  addTitle(slide, 'BTP 知识库 — 功能概览');

  const panelY = 3.7, panelH = H - 3.7 - 0.7;
  const panelW = (W - 2.8) / 2 - 0.2;
  const lx = 1.3, rx = lx + panelW + 0.38;

  // Left panel
  addPanel(slide, lx, panelY, panelW, panelH);
  addPanelTitle(slide, 'BTP 知识库功能', lx, panelY + 0.15, panelW);

  const bullets1 = [
    ['智能意图识别，自动路由三种处理路径', false],
    ['BTP 服务查询：搜索 SAP Discovery Center 全量服务目录，获取定价与路线图', false],
    ['开发向导生成：输入业务场景，自动匹配 S/4HANA API + 生成 5 章完整开发指南', false],
    ['通用 BTP 问答：三级知识检索瀑布策略，覆盖 BTP 平台开发全场景', false],
    ['占位示例："如何开发一个采购申请应用"', false],
  ];
  let by = panelY + 0.85;
  bullets1.forEach(([t]) => {
    addBullet(slide, t, lx + 0.22, by, panelW - 0.44, { h: 0.6 });
    by += 0.72;
  });

  // tags
  addTags(slide, ['服务查询', '开发向导', '通用问答', '采购', '销售', '财务/HR'],
    lx + 0.22, panelY + panelH - 0.62);

  // Right panel
  addPanel(slide, rx, panelY, panelW, panelH);
  addPanelTitle(slide, '多源知识融合体系', rx, panelY + 0.15, panelW);

  const bullets2 = [
    'SAP Discovery Center（MCP）\n10 大服务类别全量目录，含定价、路线图、文档链接',
    'AI Core 文档知识库（S3 向量检索）\nhelp.sap.com BTP 官方文档，按主题分块存储',
    'help.sap.com（MCP 实时搜索）\n实时检索 BTP / CAP / UI5 / SAP AI 官方文档片段',
    'S/4HANA API 精选列表\n按业务领域预置关键接口，含端点 / 实体 / OData 协议',
  ];
  let by2 = panelY + 0.85;
  bullets2.forEach(t => {
    addBullet(slide, t, rx + 0.22, by2, panelW - 0.44, { h: 0.72 });
    by2 += 0.85;
  });

  // Legend dots
  const legend = [
    ['2D8B4E', 'Grounding（向量检索）'],
    ['D0691A', 'MCP（实时搜索）'],
    ['B5292B', 'AI Core（直接推理）'],
    ['6D7B8A', 'No-AI（未连接）'],
  ];
  let lcy = panelY + panelH - 0.62;
  let lcx = rx + 0.22;
  legend.forEach(([color, label]) => {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: lcx, y: lcy + 0.1, w: 0.25, h: 0.25,
      fill: { color }, line: { color }
    });
    slide.addText(label, {
      x: lcx + 0.3, y: lcy, w: 2.6, h: 0.44,
      fontSize: 10, color: '333333', fontFace: 'Arial'
    });
    lcx += 3.0;
    if (lcx > rx + panelW - 0.5) { lcx = rx + 0.22; lcy += 0.42; }
  });

  addFooter(slide);
}


// ════════════════════════════════════════════════════════════════════════
// SLIDE 2 — 智能意图识别与三路由分流
// ════════════════════════════════════════════════════════════════════════
{
  const slide = pptx.addSlide();
  addTopBar(slide);
  addBadge(slide, '核心功能 08 / 10');
  addTitle(slide, '智能意图识别与三路由分流');

  const panelY = 3.7, panelH = H - 3.7 - 0.7;
  const centerW = 4.8;
  const sideW = (W - 2.8 - centerW - 0.6) / 3;  // 3 side cols (left + 2 right)
  const gap = 0.2;

  // service (leftmost)
  const x0 = 1.3;
  addPanel(slide, x0, panelY, sideW, panelH);
  // intent tag
  slide.addShape(pptx.ShapeType.rect, {
    x: x0 + 0.22, y: panelY + 0.12, w: 1.4, h: 0.35,
    fill: { color: MED_BLUE }, line: { color: MED_BLUE }
  });
  slide.addText('service', { x: x0 + 0.22, y: panelY + 0.12, w: 1.4, h: 0.35,
    fontSize: 10, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial' });
  addPanelTitle(slide, 'BTP 服务查询', x0, panelY + 0.58, sideW);
  const svc = ['解析服务关键词或业务场景','调用 MCP Discovery Center 搜索',
    '精准查询：获取服务详情（定价/路线图）','广度查询：按 10 类分组汇总全量服务',
    'AI Core 翻译中文 + 结构化回答'];
  let sy = panelY + 1.15;
  svc.forEach((t, i) => { addStep(slide, i+1, t, x0+0.22, sy, sideW-0.8); sy += 0.75; });
  slide.addShape(pptx.ShapeType.rect, {
    x: x0+0.22, y: panelY+panelH-0.52, w: 3.0, h: 0.38,
    fill: { color: MED_BLUE }, line: { color: MED_BLUE }
  });
  slide.addText('sourceType: mcp', { x: x0+0.22, y: panelY+panelH-0.52, w: 3.0, h: 0.38,
    fontSize: 10, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial' });

  // center intent engine
  const cx = x0 + sideW + gap;
  slide.addShape(pptx.ShapeType.rect, {
    x: cx, y: panelY, w: centerW, h: panelH,
    fill: { color: DARK_BLUE }, line: { color: DARK_BLUE }
  });
  slide.addText('🧠', { x: cx, y: panelY + 0.5, w: centerW, h: 0.7,
    fontSize: 28, align: 'center', valign: 'middle' });
  slide.addText('意图识别引擎', { x: cx, y: panelY + 1.3, w: centerW, h: 0.55,
    fontSize: 15, bold: true, color: WHITE, align: 'center', fontFace: 'Arial' });
  slide.addText('SAP AI Core · Claude 模型 · ≤ 96 tokens', { x: cx, y: panelY + 1.95, w: centerW, h: 0.45,
    fontSize: 11, color: 'A8C4DE', align: 'center', fontFace: 'Arial' });
  slide.addShape(pptx.ShapeType.line, {
    x: cx + 0.4, y: panelY + 2.55, w: centerW - 0.8, h: 0,
    line: { color: '3A6A9A', width: 1 }
  });
  slide.addText('输入：用户查询\n输出：\n  · service\n  · guide\n  · general\n  + domain\n  + scenario', {
    x: cx + 0.3, y: panelY + 2.7, w: centerW - 0.6, h: 4.2,
    fontSize: 11, color: 'A8C4DE', fontFace: 'Arial', valign: 'top'
  });

  // guide
  const gx = cx + centerW + gap;
  addPanel(slide, gx, panelY, sideW, panelH);
  slide.addShape(pptx.ShapeType.rect, {
    x: gx + 0.22, y: panelY + 0.12, w: 1.4, h: 0.35,
    fill: { color: MED_BLUE }, line: { color: MED_BLUE }
  });
  slide.addText('guide', { x: gx + 0.22, y: panelY + 0.12, w: 1.4, h: 0.35,
    fontSize: 10, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial' });
  addPanelTitle(slide, '开发向导生成', gx, panelY + 0.58, sideW);
  const guide = ['识别业务领域（采购/销售/财务/HR/库存）','检索 S/4HANA API 精选列表（领域专属）',
    'S3 向量知识库增强（可选）','AI Core 生成 5 章开发指南（4096 tokens）',
    '返回 API 卡片列表 + Markdown 指南'];
  let gy = panelY + 1.15;
  guide.forEach((t, i) => { addStep(slide, i+1, t, gx+0.22, gy, sideW-0.8); gy += 0.75; });
  slide.addShape(pptx.ShapeType.rect, {
    x: gx+0.22, y: panelY+panelH-0.52, w: 3.4, h: 0.38,
    fill: { color: MED_BLUE }, line: { color: MED_BLUE }
  });
  slide.addText('sourceType: grounding / ai-core', { x: gx+0.22, y: panelY+panelH-0.52, w: 3.4, h: 0.38,
    fontSize: 10, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial' });

  // general
  const nx = gx + sideW + gap;
  addPanel(slide, nx, panelY, sideW, panelH);
  slide.addShape(pptx.ShapeType.rect, {
    x: nx + 0.22, y: panelY + 0.12, w: 1.5, h: 0.35,
    fill: { color: MED_BLUE }, line: { color: MED_BLUE }
  });
  slide.addText('general', { x: nx + 0.22, y: panelY + 0.12, w: 1.5, h: 0.35,
    fontSize: 10, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial' });
  addPanelTitle(slide, '通用 BTP 问答', nx, panelY + 0.58, sideW);
  const gen = ['优先：S3 文档知识库向量检索（Grounding）','备选：MCP help.sap.com 实时文档搜索',
    '兜底：AI Core 直接推理（无检索上下文）','返回带引用来源的中文答案'];
  let ny2 = panelY + 1.15;
  gen.forEach((t, i) => { addStep(slide, i+1, t, nx+0.22, ny2, sideW-0.8); ny2 += 0.85; });
  slide.addShape(pptx.ShapeType.rect, {
    x: nx+0.22, y: panelY+panelH-0.52, w: 3.8, h: 0.38,
    fill: { color: MED_BLUE }, line: { color: MED_BLUE }
  });
  slide.addText('sourceType: grounding / mcp / ai-core / no-ai', {
    x: nx+0.22, y: panelY+panelH-0.52, w: 3.8, h: 0.38,
    fontSize: 9, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial' });

  addFooter(slide);
}


// ════════════════════════════════════════════════════════════════════════
// SLIDE 3 — 开发向导生成：工作原理与输出结构
// ════════════════════════════════════════════════════════════════════════
{
  const slide = pptx.addSlide();
  addTopBar(slide);
  addBadge(slide, '核心功能 09 / 10');
  addTitle(slide, '开发向导生成 — 工作原理与输出结构');

  const panelY = 3.7, panelH = H - 3.7 - 0.7;
  const panelW = (W - 2.8) / 2 - 0.2;
  const lx = 1.3, rx = lx + panelW + 0.38;

  // Left: flow
  addPanel(slide, lx, panelY, panelW, panelH);
  addPanelTitle(slide, '生成流程', lx, panelY + 0.15, panelW);

  const flow = [
    '6 大业务领域：采购 / 销售 / 财务 / HR / 库存 / 自定义',
    '领域 API 精选：S/4HANA API 预置库自动匹配关键接口（OData V2 / V4）',
    '知识增强（可选）：S3 向量知识库检索最相关 BTP 文档片段',
    'AI Core 编排：Claude 基于 API 列表 + Grounding 生成结构化指南（最多 4096 tokens）',
    'API 卡片输出：每个 API 含端点、实体、协议、官方文档链接、弃用状态',
  ];
  let fy = panelY + 0.85;
  flow.forEach(t => {
    addBullet(slide, t, lx + 0.22, fy, panelW - 0.44, { h: 0.65 });
    fy += 0.78;
  });

  // divider
  slide.addShape(pptx.ShapeType.line, {
    x: lx + 0.22, y: panelY + panelH - 1.0, w: panelW - 0.44, h: 0,
    line: { color: BORDER_CLR, width: 1 }
  });

  addTags(slide, ['采购申请', '销售订单', '财务凭证', 'HR 员工', '库存管理'],
    lx + 0.22, panelY + panelH - 0.7);

  // Right: guide structure
  addPanel(slide, rx, panelY, panelW, panelH);
  addPanelTitle(slide, '指南输出结构（5 章节）', rx, panelY + 0.15, panelW);

  const chapters = [
    ['前置条件（Prerequisites）', '所需 BTP 服务、凭据配置、环境准备'],
    ['架构设计（Architecture）', '整体技术方案、服务拓扑与数据流'],
    ['开发步骤（Development Steps）', '7 步以上详细实施步骤，含代码示例与配置说明'],
    ['API 深度解析（API Deep-Dive）', '关键 API 端点、请求/响应示例、鉴权方式'],
    ['常见问题（FAQ）', '开发中高频问题与最佳实践建议'],
  ];
  let cy = panelY + 0.82;
  chapters.forEach(([head, desc], i) => {
    // circle number
    slide.addShape(pptx.ShapeType.ellipse, {
      x: rx + 0.22, y: cy + 0.03, w: 0.42, h: 0.42,
      fill: { color: MED_BLUE }, line: { color: MED_BLUE }
    });
    slide.addText(String(i + 1), {
      x: rx + 0.22, y: cy + 0.03, w: 0.42, h: 0.42,
      fontSize: 11, bold: true, color: WHITE,
      align: 'center', valign: 'middle', fontFace: 'Arial'
    });
    slide.addText(head, {
      x: rx + 0.75, y: cy, w: panelW - 1.0, h: 0.34,
      fontSize: 12, bold: true, color: DARK_BLUE, fontFace: 'Arial'
    });
    slide.addText(desc, {
      x: rx + 0.75, y: cy + 0.33, w: panelW - 1.0, h: 0.3,
      fontSize: 10.5, color: TEXT_SUB, fontFace: 'Arial'
    });
    cy += 0.78;
  });

  // API card previews
  slide.addShape(pptx.ShapeType.line, {
    x: rx + 0.22, y: cy, w: panelW - 0.44, h: 0,
    line: { color: BORDER_CLR, width: 1 }
  });
  slide.addText('附：相关 API 卡片清单（点击跳转官方文档）', {
    x: rx + 0.22, y: cy + 0.08, w: panelW - 0.44, h: 0.38,
    fontSize: 11, bold: true, color: DARK_BLUE, fontFace: 'Arial'
  });

  const apis = [
    ['📦 Purchase Order (MM) — OData V4', '/sap/opu/odata4/sap/api_purchaseorder_2 · PurchaseOrder, PurchaseOrderItem'],
    ['🛒 Purchase Requisition (MM) — OData V2', '/sap/opu/odata/sap/API_PURCHASEREQ_PROCESS_SRV · PurchaseRequisition'],
  ];
  let ay = cy + 0.52;
  apis.forEach(([name, meta]) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: rx + 0.22, y: ay, w: panelW - 0.44, h: 0.62,
      fill: { color: WHITE }, line: { color: BORDER_CLR, width: 0.5 }
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: rx + 0.22, y: ay, w: 0.1, h: 0.62,
      fill: { color: MED_BLUE }, line: { color: MED_BLUE }
    });
    slide.addText(name, {
      x: rx + 0.38, y: ay + 0.04, w: panelW - 0.6, h: 0.28,
      fontSize: 11, bold: true, color: MED_BLUE, fontFace: 'Arial'
    });
    slide.addText(meta, {
      x: rx + 0.38, y: ay + 0.33, w: panelW - 0.6, h: 0.24,
      fontSize: 9.5, color: '666666', fontFace: 'Arial'
    });
    ay += 0.72;
  });

  addFooter(slide);
}


// ════════════════════════════════════════════════════════════════════════
// SLIDE 4 — BTP 服务查询 & 通用问答
// ════════════════════════════════════════════════════════════════════════
{
  const slide = pptx.addSlide();
  addTopBar(slide);
  addBadge(slide, '核心功能 10 / 10');
  addTitle(slide, 'BTP 服务查询 & 通用 BTP 问答');

  const panelY = 3.7, panelH = H - 3.7 - 0.7;
  const panelW = (W - 2.8) / 2 - 0.2;
  const lx = 1.3, rx = lx + panelW + 0.38;

  // Left: BTP Service Search
  addPanel(slide, lx, panelY, panelW, panelH);
  addPanelTitle(slide, 'BTP 服务查询', lx, panelY + 0.15, panelW);

  // highlight box
  slide.addShape(pptx.ShapeType.rect, {
    x: lx + 0.22, y: panelY + 0.75, w: panelW - 0.44, h: 0.48,
    fill: { color: DARK_BLUE }, line: { color: DARK_BLUE }
  });
  slide.addText('数据来源：SAP Discovery Center（MCP 工具）', {
    x: lx + 0.22, y: panelY + 0.75, w: panelW - 0.44, h: 0.48,
    fontSize: 12, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: 'Arial'
  });

  addBullet(slide, '关键词搜索，自动识别广度 / 精准两种查询模式',
    lx + 0.22, panelY + 1.38, panelW - 0.44, { h: 0.45 });

  addBullet(slide, '广度查询（如"BTP有哪些服务"）',
    lx + 0.22, panelY + 1.92, panelW - 0.44, { h: 0.4, bold: true });
  // sub bullets
  const subL = [
    '并发检索 10 大类别 + 17 关键词搜索',
    'AI Core 翻译中文描述，按类别分组输出',
  ];
  let sly = panelY + 2.38;
  subL.forEach(t => {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: lx + 0.65, y: sly + 0.12, w: 0.13, h: 0.13,
      fill: { color: MED_BLUE }, line: { color: MED_BLUE }
    });
    slide.addText(t, { x: lx + 0.85, y: sly, w: panelW - 1.1, h: 0.38,
      fontSize: 11, color: TEXT_SUB, fontFace: 'Arial' });
    sly += 0.42;
  });

  addBullet(slide, '精准查询（如"SAP Integration Suite 定价"）',
    lx + 0.22, sly + 0.05, panelW - 0.44, { h: 0.4, bold: true });
  sly += 0.52;
  const subR = [
    '获取服务详情：定价方案 / 路线图 / 文档链接',
    'AI 结合详情数据生成结构化中文回答',
    '无结果时自动 AI 重写关键词重试',
  ];
  subR.forEach(t => {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: lx + 0.65, y: sly + 0.12, w: 0.13, h: 0.13,
      fill: { color: MED_BLUE }, line: { color: MED_BLUE }
    });
    slide.addText(t, { x: lx + 0.85, y: sly, w: panelW - 1.1, h: 0.38,
      fontSize: 11, color: TEXT_SUB, fontFace: 'Arial' });
    sly += 0.42;
  });

  addTags(slide, ['Integration Suite', 'ABAP Cloud', 'CAP', 'Kyma'],
    lx + 0.22, panelY + panelH - 0.65);

  // Right: General Q&A waterfall
  addPanel(slide, rx, panelY, panelW, panelH);
  addPanelTitle(slide, '通用 BTP 问答 — 三级检索瀑布', rx, panelY + 0.15, panelW);

  const wfSteps = [
    ['2D8B4E', 'Level 1', 'S3 文档知识库（向量语义检索）',
      'SAP AI Core Document Grounding · help.sap.com BTP 全量文档 · 语义最近邻搜索'],
    ['D0691A', 'Level 2', 'MCP help.sap.com 实时搜索（备选）',
      '实时检索 btp-cloud-platform / cap / ui5 / sap-artificial-intelligence 文档'],
    ['B5292B', 'Level 3', 'AI Core 直接推理（兜底回答）',
      '无检索上下文时 Claude 基于模型知识直接回答，声明来源为 ai-core'],
  ];
  let wy = panelY + 0.75;
  wfSteps.forEach(([color, level, title, desc]) => {
    // colored label tab
    slide.addShape(pptx.ShapeType.rect, {
      x: rx + 0.22, y: wy, w: 1.3, h: 1.05,
      fill: { color }, line: { color }
    });
    slide.addText(level, {
      x: rx + 0.22, y: wy, w: 1.3, h: 1.05,
      fontSize: 11, bold: true, color: WHITE,
      align: 'center', valign: 'middle', fontFace: 'Arial'
    });
    // body box
    slide.addShape(pptx.ShapeType.rect, {
      x: rx + 1.52, y: wy, w: panelW - 1.74, h: 1.05,
      fill: { color: WHITE }, line: { color: BORDER_CLR, width: 0.5 }
    });
    slide.addText(title, {
      x: rx + 1.62, y: wy + 0.06, w: panelW - 1.9, h: 0.38,
      fontSize: 12, bold: true, color: DARK_BLUE, fontFace: 'Arial'
    });
    slide.addText(desc, {
      x: rx + 1.62, y: wy + 0.48, w: panelW - 1.9, h: 0.48,
      fontSize: 10.5, color: '444444', fontFace: 'Arial', wrap: true
    });
    wy += 1.2;
  });

  // divider
  slide.addShape(pptx.ShapeType.line, {
    x: rx + 0.22, y: wy + 0.1, w: panelW - 0.44, h: 0,
    line: { color: BORDER_CLR, width: 1 }
  });

  addBullet(slide, '回答附带来源标识 Badge 与引用文档链接（citation numbers）',
    rx + 0.22, wy + 0.25, panelW - 0.44, { h: 0.45 });
  addBullet(slide, '支持 BTP / CAP / UI5 / AI 服务 / Kyma / ABAP 环境全场景问答',
    rx + 0.22, wy + 0.78, panelW - 0.44, { h: 0.45 });

  addFooter(slide);
}


// ── Write file ────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, '..', 'docs', 'btp-ppt-slides.pptx');
pptx.writeFile({ fileName: outPath })
  .then(() => console.log('✅ 已生成：' + outPath))
  .catch(e => { console.error('❌ 生成失败：', e.message); process.exit(1); });
