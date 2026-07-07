import gradio as gr
from config import load_config
from agent import SAPKnowledgeAgent


def create_app() -> gr.Blocks:
    cfg = load_config()
    agent = SAPKnowledgeAgent(
        anthropic_api_key=cfg["anthropic_api_key"],
        sap_s_user=cfg["sap_s_user"],
        sap_s_password=cfg["sap_s_password"],
    )

    def respond(message: str, history: list) -> str:
        return agent.chat(message, history)

    with gr.Blocks(title="SAP Knowledge Agent", theme=gr.themes.Soft()) as app:
        gr.Markdown(
            """
            # SAP Knowledge Agent
            **Powered by Claude AI**

            Ask me about:
            - Clean Core concepts and principles (洁净核心概念)
            - SAP object classification A/B/C/D (对象等级分类)
            - Replacement APIs for deprecated objects (废弃对象替代 API)
            - SAP Notes search (SAP Note 搜索)
            """
        )
        gr.ChatInterface(
            fn=respond,
            examples=[
                "What is Clean Core?",
                "什么是洁净核心？",
                "How do I classify BAPI_PO_CREATE1?",
                "BAPI_PO_CREATE1 废弃了，有什么替代 API？",
                "Search SAP Notes about Profit Center",
                "搜索关于内存溢出的 SAP Note",
            ],
            cache_examples=False,
        )

    return app


if __name__ == "__main__":
    app = create_app()
    app.launch(
        server_name="0.0.0.0",
        server_port=7860,
        share=False,
        inbrowser=True,
    )
