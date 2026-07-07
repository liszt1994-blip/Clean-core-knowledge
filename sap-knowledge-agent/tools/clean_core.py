CLEAN_CORE_KNOWLEDGE = {
    "clean core": {
        "definition": "SAP's principle for keeping SAP S/4HANA upgrade-safe and extensible without modifying the core system.",
        "details": [
            "Only use SAP-released, stable APIs — not internal or deprecated objects",
            "Never modify SAP standard code (no modifications to SAP repository objects in the SAP namespace)",
            "Build extensions on SAP BTP (Business Technology Platform) using side-by-side extensibility",
            "Use SAP Integration Suite for process integration instead of custom RFC/BAPI calls",
            "Follow the Three-Tier model: Core (SAP-managed), Integration, Extension",
        ],
        "why": "Ensures smooth upgrades to future SAP releases (e.g., S/4HANA Cloud), reduces TCO, and enables continuous innovation.",
        "related": ["Released API", "BTP Extension", "Tier 1", "Tier 2", "Tier 3"],
    },
    "released api": {
        "definition": "An SAP object officially released for customer use, stable across upgrades and patches.",
        "details": [
            "Marked with release status 'Released' in SAP SE80 or API Hub",
            "SAP guarantees backward compatibility across releases",
            "Examples: OData V4 services in SAP Business Accelerator Hub, CDS Views with @VDM.viewType: #CONSUMPTION",
            "BAPIs listed in SAP API Hub with 'Released' status",
            "Use transaction /IWFND/MAINT_SERVICE or SAP Business Accelerator Hub to verify",
        ],
        "why": "Using only released APIs ensures your integration survives SAP upgrades without breaking.",
        "related": ["Clean Core", "Grade A", "SAP API Hub"],
    },
    "deprecated": {
        "definition": "An SAP object that SAP plans to discontinue. A replacement API exists.",
        "details": [
            "SAP marks objects as deprecated when a better replacement exists",
            "Deprecated objects may be removed in future releases",
            "Examples: Many classic BAPIs are deprecated in favor of OData/CDS-based APIs",
            "Check SAP Note or API documentation for the recommended replacement",
            "Grade C in Clean Core classification",
        ],
        "why": "Continuing to use deprecated objects risks breakage during upgrades and misses modern capabilities.",
        "related": ["Grade C", "Replacement API", "Migration"],
    },
    "btp extension": {
        "definition": "A Clean Core-compliant extension built on SAP Business Technology Platform, outside the SAP core system.",
        "details": [
            "Uses SAP BTP services: CAP (Cloud Application Programming), SAPUI5, Integration Suite",
            "Communicates with S/4HANA only via Released APIs (OData, RFC released, Events)",
            "Deployed as microservices on BTP Cloud Foundry or Kyma",
            "No modifications to SAP standard objects in the backend system",
            "Supports side-by-side extensibility pattern",
        ],
        "why": "BTP extensions survive SAP upgrades cleanly and can be scaled independently.",
        "related": ["Clean Core", "CAP", "Side-by-Side Extensibility"],
    },
    "tier 1": {
        "definition": "The SAP-managed core system (S/4HANA). Must remain clean — no custom code modifications.",
        "details": [
            "Contains SAP standard business logic, data model, and processes",
            "Only SAP delivers code changes here via standard updates",
            "Customers interact via Released APIs only",
            "Enhancing via SAP standard extensibility (BADI, Custom Fields via Fiori) is allowed",
            "Direct code modifications ('Mods') are strictly forbidden in Clean Core",
        ],
        "related": ["Clean Core", "Tier 2", "Tier 3"],
    },
    "tier 2": {
        "definition": "The integration layer between SAP core and external systems/extensions.",
        "details": [
            "Uses SAP Integration Suite (formerly Cloud Integration / CPI)",
            "Event-driven integration using SAP Event Mesh",
            "API Management for exposing and consuming APIs",
            "Only uses Released APIs to talk to Tier 1",
            "No business logic — pure routing, transformation, orchestration",
        ],
        "related": ["Tier 1", "Tier 3", "SAP Integration Suite", "Clean Core"],
    },
    "tier 3": {
        "definition": "The extension layer — custom business logic and apps built on SAP BTP.",
        "details": [
            "Custom applications built with CAP, SAPUI5, or partner tools",
            "Side-by-side extensions that add new business capability",
            "Connects to Tier 1 only through Tier 2 (Integration) or directly via Released APIs",
            "Full customer control — can use any BTP service or external technology",
            "Examples: Custom approval workflows, custom Fiori apps, partner add-ons",
        ],
        "related": ["BTP Extension", "Tier 1", "Tier 2", "CAP"],
    },
    "cap": {
        "definition": "SAP Cloud Application Programming Model — a framework for building enterprise-grade services and apps on BTP.",
        "details": [
            "Open-source framework supporting Node.js and Java runtimes",
            "Uses CDS (Core Data Services) for data modeling",
            "Built-in support for OData V4, multitenancy, authorization, localization",
            "Best practice for Tier 3 extensions in Clean Core",
            "Integrates natively with SAP HANA, SAP Event Mesh, XSUAA",
        ],
        "related": ["BTP Extension", "CDS", "Tier 3"],
    },
    "cds": {
        "definition": "Core Data Services — SAP's domain-specific language for defining data models, views, and service interfaces.",
        "details": [
            "Used in both ABAP (S/4HANA backend) and CAP (BTP/Node.js/Java)",
            "ABAP CDS Views replace classic database views, support VDM (Virtual Data Model)",
            "CAP CDS used to define domain models, services, and OData endpoints",
            "CDS Views with @VDM.viewType: #CONSUMPTION are Released APIs",
            "Supports annotations for Fiori UI, authorization, analytics",
        ],
        "related": ["CAP", "Released API", "OData", "VDM"],
    },
    "vdm": {
        "definition": "Virtual Data Model — SAP's layered data model in S/4HANA built with ABAP CDS Views.",
        "details": [
            "Three layers: Basic Interface Views (I_*), Composite Interface Views (I_*), Consumption Views (C_*)",
            "Only Consumption Views (C_*) are Released for customer use",
            "Replaces classic SAP table access — never read ACDOCA, BSEG directly in extensions",
            "OData services in SAP API Hub are typically based on VDM Consumption Views",
            "Check annotation @VDM.viewType: #CONSUMPTION to confirm Released status",
        ],
        "related": ["CDS", "Released API", "OData"],
    },
    "odata": {
        "definition": "Open Data Protocol — the standard REST-based API protocol used by SAP for S/4HANA services.",
        "details": [
            "SAP supports OData V2 (legacy) and OData V4 (preferred for new development)",
            "All SAP Fiori apps communicate with S/4HANA via OData",
            "OData V4 services in SAP Business Accelerator Hub are Grade A (Released APIs)",
            "Use /sap/opu/odata/sap/ namespace for S/4HANA OData services",
            "OData V4 adds features: computed annotations, batch operations, async requests",
        ],
        "related": ["Released API", "VDM", "Grade A"],
    },
    "badi": {
        "definition": "Business Add-In — SAP's standard enhancement framework for adding customer logic to SAP processes.",
        "details": [
            "Allowed in Clean Core — it's SAP's official extensibility mechanism",
            "Defined by SAP, implemented by customers in ABAP classes",
            "Called at specific extension points in SAP standard code",
            "Examples: MM60_PRICE_DETERMINATION, SD_SALESDOCUMENT_SAVE",
            "Use transaction SE18/SE19 to find and implement BADIs",
            "Survives SAP upgrades because SAP maintains the interface",
        ],
        "related": ["Clean Core", "Tier 1", "ABAP Extension"],
    },
    "key user extensibility": {
        "definition": "SAP's no-code/low-code extensibility tools for business users and administrators in S/4HANA Cloud.",
        "details": [
            "Add Custom Fields to standard SAP objects via Fiori app 'Custom Fields and Logic'",
            "Create Custom Business Objects for simple standalone data",
            "Adapt Fiori UIs using 'UI Adaptation' (SAPUI5 flexibility)",
            "Define Custom Logic (BAdI implementations) via 'Custom Logic' app",
            "All 100% Clean Core — delivered by SAP as official extensibility",
        ],
        "related": ["Clean Core", "Tier 1", "BAdI", "Fiori"],
    },
}


def explain_clean_core_concept(concept: str) -> dict:
    """
    Return structured knowledge about a SAP Clean Core concept.
    """
    concept_lower = concept.lower().strip()

    # Try exact match first, then partial match
    knowledge = CLEAN_CORE_KNOWLEDGE.get(concept_lower)
    if not knowledge:
        for key, value in CLEAN_CORE_KNOWLEDGE.items():
            if key in concept_lower or concept_lower in key:
                knowledge = value
                break

    if knowledge:
        return {
            "concept": concept,
            "found": True,
            "definition": knowledge["definition"],
            "details": knowledge.get("details", []),
            "why": knowledge.get("why", ""),
            "related_concepts": knowledge.get("related", []),
            "source": "SAP Clean Core Guidelines & SAP Documentation",
        }
    else:
        return {
            "concept": concept,
            "found": False,
            "message": (
                f"Specific entry for '{concept}' not found in local knowledge base. "
                f"Please explain this concept using your general SAP knowledge. "
                f"Context: Clean Core is SAP's principle for upgrade-safe S/4HANA systems using "
                f"only Released APIs, BTP extensions, and standard SAP extensibility mechanisms."
            ),
            "source": "SAP Clean Core Guidelines",
        }
