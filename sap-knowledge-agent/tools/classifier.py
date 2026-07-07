SAP_OBJECT_KNOWLEDGE = {
    # ── Grade A: Released APIs ──────────────────────────────────────────────
    "BAPI_TRANSACTION_COMMIT": ("A", "SAP Released BAPI for committing LUW. Stable, widely used, officially released."),
    "BAPI_TRANSACTION_ROLLBACK": ("A", "SAP Released BAPI for rolling back LUW. Stable and officially released."),
    "BAPI_PO_CREATE1": ("C", "Deprecated BAPI for Purchase Order creation. Replaced by OData API 'Purchasing Document' (API_PURCHASEORDER_PROCESS_SRV) in SAP API Hub."),
    "BAPI_PO_CHANGE": ("C", "Deprecated BAPI for Purchase Order change. Use OData API API_PURCHASEORDER_PROCESS_SRV instead."),
    "BAPI_PO_GETDETAIL1": ("B", "Unreleased but widely-used BAPI for PO details. Not officially released. Prefer OData A_PurchaseOrder entity."),
    "BAPI_SALESORDER_CREATEFROMDAT2": ("C", "Deprecated BAPI for Sales Order creation. Replaced by OData API 'Sales Order' (API_SALES_ORDER_SRV)."),
    "BAPI_SALESORDER_CHANGE": ("C", "Deprecated BAPI for Sales Order change. Use OData API API_SALES_ORDER_SRV."),
    "BAPI_SALESORDER_GETLIST": ("B", "Unreleased but stable BAPI. Prefer OData A_SalesOrder entity."),
    "BAPI_ACC_DOCUMENT_POST": ("C", "Deprecated BAPI for FI document posting. Replaced by OData Journal Entry API (API_JOURNALENTRYITEMBASIC_SRV) or IDoc FIDCCP02."),
    "BAPI_MATERIAL_SAVEDATA": ("C", "Deprecated BAPI for material master update. Replaced by OData Product Master API (API_PRODUCT_SRV)."),
    "BAPI_MATERIAL_GETLIST": ("B", "Unreleased BAPI for material list. Prefer OData API_PRODUCT_SRV."),
    "BAPI_GOODSMVT_CREATE": ("B", "Widely-used BAPI for Goods Movement, not officially released. Check OData API_GOODSMVT_SRV for Released alternative."),
    "BAPI_INCOMINGINVOICE_CREATE": ("C", "Deprecated BAPI. Replaced by OData Supplier Invoice API (API_SUPPLIERINVOICE_PROCESS_SRV)."),
    "BAPI_EMPLOYEE_GETDATA": ("B", "HCM BAPI, not released for cloud. Use SuccessFactors OData API for HR data in S/4HANA Cloud."),
    "BAPI_COSTCENTER_GETLIST": ("B", "CO BAPI, unreleased but stable. Use OData CostCenter API or CDS View I_CostCenter."),
    "BAPI_COMPANYCODE_GETLIST": ("B", "Unreleased BAPI. Use CDS View I_CompanyCode or OData API_COMPANYCODE_SRV."),
    "BAPI_CUSTOMER_GETLIST": ("B", "Unreleased BAPI. Use OData Business Partner API (API_BUSINESS_PARTNER) instead."),
    "BAPI_VENDOR_GETLIST": ("B", "Unreleased BAPI. Use OData Business Partner API (API_BUSINESS_PARTNER) instead."),
    "BAPI_OUTB_DELIVERY_CREATE_SLS": ("B", "Outbound Delivery BAPI, not officially released. Check SAP API Hub for OData alternative."),
    "RFC_READ_TABLE": ("D", "Internal RFC, NOT released. Violates Clean Core. Use CDS Views or Released OData services instead. High risk in cloud."),
    "SUSR_USER_CHANGE_PASSWORD_RFC": ("B", "Identity RFC, use with caution. Prefer SAP Identity Authentication Service (IAS) for cloud."),
    # ── Transactions ────────────────────────────────────────────────────────
    "SE16": ("D", "Internal debugging transaction. Direct table access violates Clean Core. Never use in production integrations."),
    "SE16N": ("D", "Internal debugging transaction. Same as SE16 — violates Clean Core."),
    "SE38": ("B", "ABAP Editor — development tool, not an API. Not applicable for integrations."),
    "SE80": ("B", "Object Navigator — development tool only. Used to check release status of objects."),
    "SM30": ("D", "Table maintenance — direct table manipulation, violates Clean Core."),
    "MARA": ("B", "SAP table for General Material Data. Direct table access is not a Released API. Use OData API_PRODUCT_SRV or CDS View I_ProductBasic."),
    "BSEG": ("D", "FI line item table — direct access violates Clean Core. Use CDS View I_JournalEntryItem (VDM Released) instead."),
    "ACDOCA": ("D", "Universal Journal table — direct access violates Clean Core. Use CDS View I_ActualPlanJournalEntryItem or OData Journal Entry API."),
    "EKKO": ("B", "Purchasing header table — direct access is Grade B at best. Use OData API_PURCHASEORDER_PROCESS_SRV."),
    "EKPO": ("B", "Purchasing item table — direct access is Grade B. Use OData API_PURCHASEORDER_PROCESS_SRV."),
    "VBAK": ("B", "Sales order header table — direct access is Grade B. Use OData API_SALES_ORDER_SRV."),
    "VBAP": ("B", "Sales order item table — direct access is Grade B. Use OData API_SALES_ORDER_SRV."),
    "KNA1": ("B", "Customer master table — use Business Partner API (API_BUSINESS_PARTNER) instead."),
    "LFA1": ("B", "Vendor master table — use Business Partner API (API_BUSINESS_PARTNER) instead."),
}

GRADE_RULES = {
    "A": "SAP Released API — officially supported, stable across upgrades. Safe to use.",
    "B": "Unreleased but stable — widely used but not officially released. Use with caution, plan migration.",
    "C": "Deprecated — SAP has flagged this for removal. A replacement API exists. Must migrate.",
    "D": "Not suitable for Clean Core — internal object, direct table access, or violates SAP extensibility guidelines.",
}


def classify_sap_object(object_name: str) -> dict:
    """
    Classify a SAP object by Clean Core grade (A/B/C/D).
    Uses a knowledge base of known objects, with fallback heuristics.
    """
    name_upper = object_name.upper().strip()

    # Check knowledge base first
    if name_upper in SAP_OBJECT_KNOWLEDGE:
        grade, reason = SAP_OBJECT_KNOWLEDGE[name_upper]
        return {
            "object_name": object_name,
            "grade": grade,
            "reason": reason,
            "grade_definition": GRADE_RULES[grade],
            "recommendation": _get_recommendation(grade),
            "source": "SAP Clean Core Classification Knowledge Base",
        }

    # Heuristic rules for unknown objects
    if name_upper.startswith("Z") or name_upper.startswith("Y"):
        grade = "D"
        reason = f"'{object_name}' is in Z/Y customer namespace — custom object, not a Released API."
    elif name_upper.startswith("/"):
        grade = "B"
        reason = f"'{object_name}' is in a partner/SAP namespace. Verify release status in SAP API Hub or SE80."
    elif name_upper.startswith("BAPI_"):
        grade = "B"
        reason = (
            f"'{object_name}' is a BAPI. Most BAPIs are Grade B (unreleased) or C (deprecated) in S/4HANA. "
            f"Check SAP API Hub for an OData replacement. Classic BAPIs are being deprecated in favor of OData V4."
        )
    elif name_upper.startswith("RFC_") or name_upper.startswith("FUNC_"):
        grade = "B"
        reason = f"'{object_name}' is a Function Module/RFC. Most RFCs are not Released APIs. Verify in SE80."
    elif name_upper.startswith("API_") or name_upper.startswith("C_") or name_upper.startswith("I_"):
        grade = "A"
        reason = (
            f"'{object_name}' follows SAP naming conventions for Released APIs: "
            f"API_ prefix (OData service) or C_/I_ prefix (CDS View). Likely Grade A — verify on SAP API Hub."
        )
    else:
        grade = "B"
        reason = (
            f"'{object_name}' — release status unknown. Could be a standard SAP object (tables, programs, transactions). "
            f"Check release status using transaction SE80 or SAP Business Accelerator Hub."
        )

    return {
        "object_name": object_name,
        "grade": grade,
        "reason": reason,
        "grade_definition": GRADE_RULES[grade],
        "recommendation": _get_recommendation(grade),
        "source": "Heuristic classification — verify on SAP API Hub",
    }


def _get_recommendation(grade: str) -> str:
    recommendations = {
        "A": "Safe to use. This is a Released API — no migration needed.",
        "B": "Use with caution. Verify release status in SAP Business Accelerator Hub (api.sap.com). Plan migration to a Released OData/CDS API.",
        "C": "Must migrate. Search SAP API Hub for the replacement OData or CDS-based API. Check the object's documentation for migration guide.",
        "D": "Do not use in Clean Core systems. Refactor to use Released APIs or BTP-based extensions.",
    }
    return recommendations.get(grade, "Verify on SAP API Hub.")
