from __future__ import annotations

from typing import Any, TypedDict
from datetime import date, timedelta
from urllib.request import Request, urlopen
import json

from fastapi import FastAPI
from pydantic import BaseModel

try:
    from langgraph.graph import END, START, StateGraph
except ImportError as exc:  # pragma: no cover - gives a useful startup error
    raise RuntimeError("请先安装 agent_service/requirements.txt") from exc


class OperationState(TypedDict, total=False):
    query: str
    intent: str
    target_date: str
    result: dict[str, Any]
    response: str
    shops: list[dict[str, Any]]
    rows: list[dict[str, Any]]
    errors: list[dict[str, Any]]


class AskRequest(BaseModel):
    query: str


def parse_request(state: OperationState) -> OperationState:
    query = state["query"]
    intent = "sales_summary" if any(word in query for word in ("销售", "成交", "退款", "净销售")) else "unsupported"
    target = date.today() - timedelta(days=1) if ("昨天" in query or "昨日" in query) else date.today()
    return {"intent": intent, "target_date": target.isoformat()}


def bridge(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(f"http://127.0.0.1:18769{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def load_shops(state: OperationState) -> OperationState:
    shops = bridge("GET", "/agent/shops").get("shops", [])
    checked = []
    for shop in shops:
        try:
            status = bridge("POST", "/agent/check-login", {"shop_id": shop["id"]})
            shop = {**shop, "status": status.get("status", shop.get("status"))}
        except Exception as exc:
            shop = {**shop, "status": "检查失败", "check_error": str(exc)}
        checked.append(shop)
    return {"shops": checked}


def collect_sales(state: OperationState) -> OperationState:
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for shop in state.get("shops", []):
        if shop.get("status") != "已登录":
            errors.append({"shop_id": shop["id"], "shop_name": shop["name"], "error": "login_required"})
            continue
        last_error = None
        for _ in range(2):
            try:
                result = bridge("POST", "/agent/collect-sales", {"shop_id": shop["id"], "date": state["target_date"]})
                rows.append({"shop_id": shop["id"], "shop_name": shop["name"], "platform": shop["platform"], **result})
                last_error = None
                break
            except Exception as exc:  # retry once per shop
                last_error = str(exc)
        if last_error:
            errors.append({"shop_id": shop["id"], "shop_name": shop["name"], "error": last_error})
    return {"rows": rows, "errors": errors}


def aggregate(state: OperationState) -> OperationState:
    sales = sum(float(x.get("salesAmount") or 0) for x in state.get("rows", []))
    refund = sum(float(x.get("refundAmount") or 0) for x in state.get("rows", []))
    return {"result": {"date": state["target_date"], "sales": sales, "refund": refund, "net": sales - refund, "rows": state.get("rows", []), "errors": state.get("errors", [])}}


def answer(state: OperationState) -> OperationState:
    if state.get("intent") != "sales_summary":
        return {"response": "MVP 当前支持销售额、退款金额和净销售额查询。"}
    result = state.get("result", {})
    return {"response": f"已完成 {result.get('date')} 采集：销售额 ¥{result.get('sales', 0):.2f}，退款 ¥{result.get('refund', 0):.2f}，净销售额 ¥{result.get('net', 0):.2f}。成功 {len(result.get('rows', []))} 个店铺，异常 {len(result.get('errors', []))} 个。"}


graph = StateGraph(OperationState)
graph.add_node("parse_request", parse_request)
graph.add_node("load_shops", load_shops)
graph.add_node("collect_sales", collect_sales)
graph.add_node("aggregate", aggregate)
graph.add_node("answer", answer)
graph.add_edge(START, "parse_request")
graph.add_edge("parse_request", "load_shops")
graph.add_edge("load_shops", "collect_sales")
graph.add_edge("collect_sales", "aggregate")
graph.add_edge("aggregate", "answer")
graph.add_edge("answer", END)
app_graph = graph.compile()

app = FastAPI(title="Shop Login Center LangGraph Agent MVP")


@app.post("/agent/ask")
def ask(request: AskRequest):
    state = app_graph.invoke({"query": request.query})
    return {"ok": True, **state}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=18768)
