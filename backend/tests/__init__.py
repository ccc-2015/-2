import os

# 单元测试使用 JSON 知识库，不依赖本机 PostgreSQL；集成验证另跑 ingest/接口。
os.environ.setdefault("KNOWLEDGE_BACKEND", "json")
