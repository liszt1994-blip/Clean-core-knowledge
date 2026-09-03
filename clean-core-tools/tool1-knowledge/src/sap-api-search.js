// tool1-knowledge/src/sap-api-search.js
// Returns curated SAP API information per domain.
// api.sap.com requires authentication for programmatic search,
// so we maintain a curated list of the most relevant APIs per domain.

const DOMAIN_APIS = {
  procurement: [
    {
      name: 'Purchase Order (A2X) - SAP S/4HANA',
      description: '创建、读取、更新和删除采购订单。支持完整的采购订单生命周期管理，包括行项目、计划行和条件。',
      url: 'https://api.sap.com/api/API_PURCHASEORDER_PROCESS_SRV/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV',
      keyEntities: ['A_PurchaseOrder', 'A_PurchaseOrderItem', 'A_PurchaseOrderScheduleLine'],
      deprecated: false,
    },
    {
      name: 'Purchase Requisition (A2X) - SAP S/4HANA',
      description: '管理采购申请的创建和处理，支持直接采购和间接采购场景。',
      url: 'https://api.sap.com/api/API_PURCHASEREQ_PROCESS_SRV/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_PURCHASEREQ_PROCESS_SRV',
      keyEntities: ['A_PurchaseRequisitionHeader', 'A_PurchaseRequisitionItem'],
      deprecated: false,
    },
    {
      name: 'Supplier (Business Partner) - SAP S/4HANA',
      description: '读取和管理供应商主数据，包括地址、银行账户和采购组织数据。',
      url: 'https://api.sap.com/api/API_BUSINESS_PARTNER/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_BUSINESS_PARTNER',
      keyEntities: ['A_BusinessPartner', 'A_Supplier', 'A_SupplierPurchasingOrg'],
      deprecated: false,
    },
    {
      name: 'Purchase Contract - SAP S/4HANA',
      description: '管理采购合同，支持合同创建、修改和条款管理。',
      url: 'https://api.sap.com/api/API_MM_PURCONTRACT_MAINTENANCE_SRV_0001/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_MM_PURCONTRACT_MAINTENANCE_SRV_0001',
      keyEntities: ['A_PurContract', 'A_PurContractItem'],
      deprecated: false,
    },
    {
      name: 'Purchase Order - SAP S/4HANA (Legacy)',
      description: '旧版采购订单接口，已被 API_PURCHASEORDER_PROCESS_SRV 替代。',
      url: 'https://api.sap.com/api/API_PO_ATTACHMENT_SRV/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_PO_ATTACHMENT_SRV',
      keyEntities: ['A_PurchaseOrderAttachment'],
      deprecated: true,
      successor: 'API_PURCHASEORDER_PROCESS_SRV',
    },
  ],
  sales: [
    {
      name: 'Sales Order (A2X) - SAP S/4HANA',
      description: '创建和管理销售订单，支持完整的订单到收款流程。',
      url: 'https://api.sap.com/api/API_SALES_ORDER_SRV/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_SALES_ORDER_SRV',
      keyEntities: ['A_SalesOrder', 'A_SalesOrderItem', 'A_SalesOrderScheduleLine'],
      deprecated: false,
    },
    {
      name: 'Customer (Business Partner) - SAP S/4HANA',
      description: '管理客户主数据，包括销售区域、付款条件和联系人。',
      url: 'https://api.sap.com/api/API_BUSINESS_PARTNER/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_BUSINESS_PARTNER',
      keyEntities: ['A_Customer', 'A_CustomerSalesArea'],
      deprecated: false,
    },
  ],
  finance: [
    {
      name: 'Journal Entry - SAP S/4HANA',
      description: '创建和查询财务凭证，支持手工过账和批量过账。',
      url: 'https://api.sap.com/api/API_JOURNALENTRYITEMBASIC_SRV/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_JOURNALENTRYITEMBASIC_SRV',
      keyEntities: ['A_JournalEntryItemBasic'],
      deprecated: false,
    },
    {
      name: 'Payment - SAP S/4HANA',
      description: '查询付款和收款信息，支持应付账款和应收账款处理。',
      url: 'https://api.sap.com/api/API_PAYMENT_0001/overview',
      protocol: 'OData V4',
      endpoint: '/sap/opu/odata4/sap/api_payment/srvd_a2x/sap/payment/0001',
      keyEntities: ['Payment', 'PaymentItem'],
      deprecated: false,
    },
  ],
  hr: [
    {
      name: 'Employee - SAP SuccessFactors',
      description: '读取和管理员工主数据，包括个人信息、职位和薪资数据。',
      url: 'https://api.sap.com/api/ECEmploymentInformation/overview',
      protocol: 'OData V2',
      endpoint: '/odata/v2/PerPersonal',
      keyEntities: ['PerPersonal', 'EmpEmployment', 'EmpJob'],
      deprecated: false,
    },
    {
      name: 'Time Off - SAP SuccessFactors',
      description: '管理员工请假申请、审批和余额查询。',
      url: 'https://api.sap.com/api/ECTimeOff/overview',
      protocol: 'OData V2',
      endpoint: '/odata/v2/TimeOff',
      keyEntities: ['TimeOffRequest', 'TimeAccountBalance'],
      deprecated: false,
    },
  ],
  inventory: [
    {
      name: 'Material Stock - SAP S/4HANA',
      description: '查询物料库存信息，包括各工厂和存储地点的库存数量。',
      url: 'https://api.sap.com/api/API_MATERIAL_STOCK_SRV/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV',
      keyEntities: ['A_MatlStkInAcctMod'],
      deprecated: false,
    },
    {
      name: 'Material (A2X) - SAP S/4HANA',
      description: '管理物料主数据，支持创建、修改和查询物料基本信息和各视图数据。',
      url: 'https://api.sap.com/api/API_MATERIAL_SRV/overview',
      protocol: 'OData V2',
      endpoint: '/sap/opu/odata/sap/API_MATERIAL_SRV',
      keyEntities: ['A_Product', 'A_ProductDescription', 'A_ProductPlant'],
      deprecated: false,
    },
  ],
};

function searchSapApis(domain, extraKeywords = '', top = 8) {
  const apis = DOMAIN_APIS[domain] || DOMAIN_APIS['procurement'];
  return Promise.resolve(apis.slice(0, top));
}

module.exports = { searchSapApis, DOMAIN_APIS };
