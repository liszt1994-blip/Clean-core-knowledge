REPLACEMENT_KNOWLEDGE = {
    # Purchase Management
    "BAPI_PO_CREATE1": {
        "replacements": [
            {
                "name": "Purchase Order - Create, Read, Update, Delete",
                "technical_name": "API_PURCHASEORDER_PROCESS_SRV",
                "type": "OData V2",
                "description": "Official Released OData API for Purchase Order CRUD operations in S/4HANA.",
                "hub_url": "https://api.sap.com/api/API_PURCHASEORDER_PROCESS_SRV",
            }
        ],
        "migration_note": "Replace BAPI_PO_CREATE1 calls with POST to /A_PurchaseOrder entity in API_PURCHASEORDER_PROCESS_SRV.",
    },
    "BAPI_PO_CHANGE": {
        "replacements": [
            {
                "name": "Purchase Order - Create, Read, Update, Delete",
                "technical_name": "API_PURCHASEORDER_PROCESS_SRV",
                "type": "OData V2",
                "description": "Use PATCH on A_PurchaseOrder entity to change POs.",
                "hub_url": "https://api.sap.com/api/API_PURCHASEORDER_PROCESS_SRV",
            }
        ],
        "migration_note": "Use PATCH /A_PurchaseOrder('{PurchaseOrder}') to update purchase order fields.",
    },
    # Sales Order
    "BAPI_SALESORDER_CREATEFROMDAT2": {
        "replacements": [
            {
                "name": "Sales Order (A2X) - Create, Read, Update, Delete",
                "technical_name": "API_SALES_ORDER_SRV",
                "type": "OData V2",
                "description": "Released OData API for Sales Order lifecycle management.",
                "hub_url": "https://api.sap.com/api/API_SALES_ORDER_SRV",
            }
        ],
        "migration_note": "Replace BAPI_SALESORDER_CREATEFROMDAT2 with POST to /A_SalesOrder in API_SALES_ORDER_SRV.",
    },
    "BAPI_SALESORDER_CHANGE": {
        "replacements": [
            {
                "name": "Sales Order (A2X) - Create, Read, Update, Delete",
                "technical_name": "API_SALES_ORDER_SRV",
                "type": "OData V2",
                "description": "Released OData API. Use PATCH on A_SalesOrder for changes.",
                "hub_url": "https://api.sap.com/api/API_SALES_ORDER_SRV",
            }
        ],
        "migration_note": "Use PATCH /A_SalesOrder('{SalesOrder}') to update sales order fields.",
    },
    # Finance / Accounting
    "BAPI_ACC_DOCUMENT_POST": {
        "replacements": [
            {
                "name": "Journal Entry - Post, Reverse",
                "technical_name": "API_JOURNALENTRYITEMBASIC_SRV",
                "type": "OData V2",
                "description": "Released OData API for posting FI journal entries.",
                "hub_url": "https://api.sap.com/api/API_JOURNALENTRYITEMBASIC_SRV",
            },
            {
                "name": "IDoc FIDCCP02",
                "technical_name": "FIDCCP02",
                "type": "IDoc",
                "description": "Alternative: IDoc-based posting for batch/async scenarios.",
                "hub_url": "",
            },
        ],
        "migration_note": "Replace BAPI_ACC_DOCUMENT_POST with OData Journal Entry API. For ACDOCA-related queries, use CDS View I_JournalEntryItem.",
    },
    # Material / Product Master
    "BAPI_MATERIAL_SAVEDATA": {
        "replacements": [
            {
                "name": "Product Master - Manage Product Master Data",
                "technical_name": "API_PRODUCT_SRV",
                "type": "OData V2",
                "description": "Released OData API for Product Master CRUD. Replaces material master BAPIs.",
                "hub_url": "https://api.sap.com/api/API_PRODUCT_SRV",
            }
        ],
        "migration_note": "Use POST/PATCH on /A_Product entity in API_PRODUCT_SRV for material data maintenance.",
    },
    "BAPI_MATERIAL_GETLIST": {
        "replacements": [
            {
                "name": "Product Master - Read Product Master Data",
                "technical_name": "API_PRODUCT_SRV",
                "type": "OData V2",
                "description": "Released OData API. Use GET /A_Product for material list queries.",
                "hub_url": "https://api.sap.com/api/API_PRODUCT_SRV",
            }
        ],
        "migration_note": "Replace BAPI_MATERIAL_GETLIST with GET /A_Product?$filter=... in API_PRODUCT_SRV.",
    },
    # Business Partner (replaces Customer/Vendor)
    "BAPI_CUSTOMER_GETLIST": {
        "replacements": [
            {
                "name": "Business Partner (A2X)",
                "technical_name": "API_BUSINESS_PARTNER",
                "type": "OData V2",
                "description": "Released API for Business Partner data (replaces separate Customer/Vendor APIs).",
                "hub_url": "https://api.sap.com/api/API_BUSINESS_PARTNER",
            }
        ],
        "migration_note": "In S/4HANA, Customer and Vendor are unified as Business Partner. Use API_BUSINESS_PARTNER with role filter.",
    },
    "BAPI_VENDOR_GETLIST": {
        "replacements": [
            {
                "name": "Business Partner (A2X)",
                "technical_name": "API_BUSINESS_PARTNER",
                "type": "OData V2",
                "description": "Released API for Business Partner data (Supplier role).",
                "hub_url": "https://api.sap.com/api/API_BUSINESS_PARTNER",
            }
        ],
        "migration_note": "Use API_BUSINESS_PARTNER with BusinessPartnerRole = 'FLVN01' for Supplier queries.",
    },
    # Supplier Invoice
    "BAPI_INCOMINGINVOICE_CREATE": {
        "replacements": [
            {
                "name": "Supplier Invoice - Post, Cancel, Get",
                "technical_name": "API_SUPPLIERINVOICE_PROCESS_SRV",
                "type": "OData V2",
                "description": "Released OData API for Supplier Invoice processing.",
                "hub_url": "https://api.sap.com/api/API_SUPPLIERINVOICE_PROCESS_SRV",
            }
        ],
        "migration_note": "Use POST to /A_SupplierInvoice in API_SUPPLIERINVOICE_PROCESS_SRV.",
    },
    # Direct table access
    "RFC_READ_TABLE": {
        "replacements": [
            {
                "name": "Use appropriate domain-specific OData API or CDS View",
                "technical_name": "Domain-specific Released API",
                "type": "OData V4 / CDS View",
                "description": "RFC_READ_TABLE is internal and not Released. Always use a domain-specific Released API instead.",
                "hub_url": "https://api.sap.com",
            }
        ],
        "migration_note": (
            "RFC_READ_TABLE should never be used in integrations. Identify the business object you need and find "
            "the corresponding Released OData API on SAP Business Accelerator Hub (api.sap.com)."
        ),
    },
    "SE16": {
        "replacements": [
            {
                "name": "Domain-specific OData or CDS consumption view",
                "technical_name": "N/A — use appropriate Released API",
                "type": "OData / CDS",
                "description": "SE16 is a debugging transaction, not an API. Use Released APIs for data access.",
                "hub_url": "https://api.sap.com",
            }
        ],
        "migration_note": "SE16/SE16N are for manual debugging only. For programmatic data access, use the Released OData API for that business object.",
    },
    # Goods Movement
    "BAPI_GOODSMVT_CREATE": {
        "replacements": [
            {
                "name": "Goods Movement - Post Goods Movement",
                "technical_name": "API_GOODSMVT_SRV",
                "type": "OData V2",
                "description": "OData API for posting goods movements (GR, GI, Transfer). Check release status in your S/4HANA release.",
                "hub_url": "https://api.sap.com/api/API_GOODSMVT_SRV",
            }
        ],
        "migration_note": "Use API_GOODSMVT_SRV for Goods Movements. Verify the MovementType mapping matches BAPI_GOODSMVT_CREATE GMCode.",
    },
}


def recommend_replacement_api(deprecated_object: str) -> dict:
    """
    Recommend modern replacement APIs for a deprecated or obsolete SAP object.
    Uses a knowledge base of known replacements.
    """
    object_upper = deprecated_object.upper().strip()
    knowledge = REPLACEMENT_KNOWLEDGE.get(object_upper)

    if knowledge:
        return {
            "deprecated_object": deprecated_object,
            "found": True,
            "replacements": knowledge["replacements"],
            "migration_note": knowledge["migration_note"],
            "hub_search_url": f"https://api.sap.com/search?query={deprecated_object}",
            "source": "SAP Clean Core Replacement API Knowledge Base",
        }
    else:
        # Generic guidance for unknown objects
        search_query = _derive_search_query(object_upper)
        return {
            "deprecated_object": deprecated_object,
            "found": False,
            "replacements": [],
            "migration_note": (
                f"No specific replacement found in knowledge base for '{deprecated_object}'. "
                f"To find the replacement: 1) Search SAP Business Accelerator Hub at api.sap.com "
                f"using keywords from the object name. 2) Check the object's documentation in SE80 "
                f"for deprecation notes. 3) Look for SAP Notes about migration from this object."
            ),
            "hub_search_url": f"https://api.sap.com/search?query={search_query}",
            "suggested_search_term": search_query,
            "source": "SAP Business Accelerator Hub — manual search required",
        }


def _derive_search_query(object_name: str) -> str:
    """Derive a human-readable search query from an SAP object name."""
    # Strip common prefixes to get domain keywords
    for prefix in ["BAPI_", "RFC_", "FM_", "Z_", "Y_"]:
        if object_name.startswith(prefix):
            object_name = object_name[len(prefix):]
            break
    # Take first meaningful segment
    parts = object_name.split("_")
    return " ".join(parts[:3]).title()
