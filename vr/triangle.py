"""收敛三角形扫描 —— 全市场日线 K 线形态筛选（短线投资专属模块，不回推开源）。

方法（包络收缩法，2026-09-14 验证于 300902/603538/600668 及全市场 2520 只）：
  上包络 top[i] = max(high[i-k..i])，下包络 bot[i] = min(low[i-k..i])，
  通道宽度 w[i] = top[i] - bot[i]。
  三角形 = 多窗口(20~120日)内 w 从左到右单调收缩(允许25%回弹)、
  左端宽度 ≥ 3 ATR(有真实收敛空间)、右端压缩 ≤ 5 ATR、
  顶点落在窗口右端(0.6W~1.4W)、当前价在通道内。
  严格集 = 缩量(vol_shrink<0.8) + 强收敛(conv≤0.35) + 前2/3窗口上/下包络各被触碰≥2次 + 收盘未破位。

数据源全免费无 key：股票池/名称走 akshare 东财列表，K线走腾讯 qfqday，实时价/市值批量走腾讯。
形态分类：对称三角 / 下降三角(顶压低·底横) / 上升三角(底抬高·顶横) / 箱体。
本模块只呈现客观形态数据——非推荐、非预测、不给买卖时机。
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from collections import deque

import astock

_TTL = 1800  # 30 分钟；盘中 K 线收盘前基本不变，收盘后彻底不变
_CACHE: dict = {}
_LOCK = threading.Lock()
_ENV_K = 5            # 包络滚动窗口
WINDOWS = (20, 30, 40, 60, 90, 120)
MIN_LEFT_W_ATR = 3.0  # 左端宽度下限(有收敛空间)
MAX_RIGHT_W_ATR = 5.0 # 右端宽度上限(已压缩)
MAX_RATIO = 0.70      # 右/左宽度比上限(至少收窄30%)
WOBBLE = 1.25         # 单调性容差(25%回弹)
STRICT_CONV = 0.35    # 严格集: 收敛比上限
STRICT_VOL = 0.8      # 严格集: 后1/3均量/前1/3均量 上限
MAX_REPORT = 60       # 返回条数上限
KLINE_RPS = 14        # K线源全局限速(请求/秒)：2500 只 ÷ 14 ≈ 3 分钟扫完，不打爆 IP
KLINE_WORKERS = 10


class _RateLimiter:
    """线程安全令牌桶：最小请求间隔 = 1/rps 秒。"""

    def __init__(self, rps: float):
        self._interval = 1.0 / rps
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self):
        with self._lock:
            now = time.monotonic()
            target = max(now, self._last + self._interval)
            self._last = target
        delay = target - now
        if delay > 0:
            time.sleep(delay)


_KLINE_LIMITER = _RateLimiter(KLINE_RPS)


# ---------------------------------------------------------------------------
# 形态检测（纯 stdlib，K线 = list of [date, open, close, high, low, volume]）
# ---------------------------------------------------------------------------

def _rolling_max(vals: list[float], k: int) -> list[float]:
    out = [float("nan")] * len(vals)
    dq: deque = deque()
    for i, v in enumerate(vals):
        while dq and dq[-1][1] <= v:
            dq.pop()
        dq.append((i, v))
        if dq[0][0] <= i - k:
            dq.popleft()
        if i >= k - 1:
            out[i] = dq[0][1]
    return out


def _rolling_min(vals: list[float], k: int) -> list[float]:
    return [-v for v in _rolling_max([-v for v in vals], k)]


def _atr(high: list[float], low: list[float], prev_close: list[float], k: int = 14) -> float:
    """最近 14 日真实波幅均值。"""
    trs = []
    for i in range(1, len(high)):
        trs.append(max(high[i] - low[i], abs(high[i] - prev_close[i]), abs(low[i] - prev_close[i])))
    if len(trs) < k:
        return 0.0
    return sum(trs[-k:]) / k


def detect(klines: list[list]) -> dict | None:
    """在 K 线上检测收敛三角形，返回最优窗口指标 dict 或 None。

    klines: [[date, open, close, high, low, volume], ...] 升序。
    """
    n = len(klines)
    if n < 60:
        return None
    dates = [k[0] for k in klines]
    high = [float(k[3]) for k in klines]
    low = [float(k[4]) for k in klines]
    close = [float(k[2]) for k in klines]
    vol = [float(k[5]) for k in klines]
    prev_close = [0.0] + close[:-1]
    atr = _atr(high, low, prev_close)
    if atr <= 0:
        return None

    best = None
    for W in WINDOWS:
        if W > n - 10:
            continue
        start = n - W
        sh = high[start:]
        sl = low[start:]
        top_env = _rolling_max(sh, _ENV_K)
        bot_env = _rolling_min(sl, _ENV_K)
        # 包络前 _ENV_K 根不稳定，剔除
        w = [top_env[i] - bot_env[i] for i in range(_ENV_K - 1, len(sh))]
        if len(w) < 15 or any(x != x for x in w):
            continue
        We = len(w)

        def at(p: float) -> float:
            return w[min(We - 1, max(0, int(round(p * (We - 1)))))]

        w10, w25, w50, w75, wR = at(0.10), at(0.25), at(0.50), at(0.75), at(1.0)
        if not all(x == x and x > 0 for x in (w10, w25, w50, w75, wR)):
            continue
        # 左端：足够宽且稳定（10%/25% 不跳变 → 排除单根尖峰造成的假宽）
        if w10 < MIN_LEFT_W_ATR * atr or w25 < MIN_LEFT_W_ATR * atr:
            continue
        if w25 > w10 * 2.0 or w10 > w25 * 2.0:
            continue
        # 单调收缩（容差）
        if not (w50 <= w25 * WOBBLE and w75 <= w50 * WOBBLE and wR <= w75 * WOBBLE):
            continue
        if wR / w10 > MAX_RATIO:
            continue
        if wR > MAX_RIGHT_W_ATR * atr:
            continue
        # 至少一侧在向中间收
        t1, tR = top_env[_ENV_K - 1 + int(0.25 * (We - 1))], top_env[-1]
        b1, bR = bot_env[_ENV_K - 1 + int(0.25 * (We - 1))], bot_env[-1]
        top_descends = tR <= t1 + 0.5 * atr
        bot_ascends = bR >= b1 - 0.5 * atr
        if not (top_descends or bot_ascends):
            continue
        # 顶点：近 1/3 宽度线性外推到 0
        seg = w[We - 3:]
        days_to_apex = 0
        if len(seg) >= 4:
            xs = list(range(len(seg)))
            mx = sum(xs) / len(xs)
            my = sum(seg) / len(xs)
            slope = sum((xs[i] - mx) * (seg[i] - my) for i in range(len(xs))) / max(1e-12, sum((xs[i] - mx) ** 2 for i in range(len(xs))))
            intercept = my - slope * mx
            if slope < 0:
                days_to_apex = max(0, int(-intercept / slope) - len(seg) + 1)
            else:
                days_to_apex = 0
        apex_pos = (W + days_to_apex) / W
        if not (0.6 <= apex_pos <= 1.4):
            continue
        # 当前价在通道内 ±1 ATR（明显突破/跌破则形态已结束，不报）
        cur = close[-1]
        if cur > tR + atr or cur < bR - atr:
            continue
        pos = (cur - bR) / (tR - bR) if tR > bR else 0.5
        # 量能收缩：后 1/3 均量 / 前 1/3 均量
        v3 = max(W // 3, 5)
        v_early = sum(vol[start:start + v3]) / v3
        vol_shrink = (sum(vol[-v3:]) / v3) / v_early if v_early > 0 else 1.0
        # 形态分类
        if top_descends and bot_ascends:
            shape = "symmetric"
        elif top_descends:
            shape = "descending"
        elif bot_ascends:
            shape = "ascending"
        else:
            shape = "box"
        # 触边（前 2/3 窗口，K线高低点贴包络 ≤0.8 ATR）
        cut = _ENV_K - 1 + int(We * 0.66)
        touch_r = sum(1 for i in range(_ENV_K - 1, cut) if (top_env[i] - sh[i]) <= 0.8 * atr)
        touch_s = sum(1 for i in range(_ENV_K - 1, cut) if (sl[i] - bot_env[i]) <= 0.8 * atr)
        # 破位次数（整窗口）：收盘价**前向**突破「不含当天」的 5 日包络。
        # 健康的三角形：价格反复测试边界但收盘不破 → broke≈0；
        # 收盘前向突破 = 形态已被打破（方向选择完成），不应再计入严格集。
        # FIX-61: 原实现 sh[_ENV_K-1+i] > top_env[i] 索引错位(比较的是 8 天后
        # 的价格 vs 4 天前的包络)，正常上涨被误判成破位，导致严格集恒空。
        close_start = start
        broke = 0
        for i in range(_ENV_K, len(sh)):
            top_excl = max(sh[i - _ENV_K:i])
            bot_excl = min(sl[i - _ENV_K:i])
            c_i = close[close_start + i]
            if c_i > top_excl or c_i < bot_excl:
                broke += 1
        status = "forming"
        if cur > tR:
            status = "broke_up"
        elif cur < bR:
            status = "broke_down"
        # strict 判据对齐全市场验证版（昨天 baostock 全市场跑出 ~270 只）：
        # 缩量 + 强收敛 + 上/下沿各触边≥2。broke 不参与 strict——收盘价突破前5日
        # 包络在趋势行情里是常态(健康三角形中位数 broke≈16)，不是形态失效信号。
        # FIX-61: broke 原为硬条件(==0)且索引错位虚高，导致严格集恒空。
        strict = (vol_shrink < STRICT_VOL and wR / w10 <= STRICT_CONV
                  and touch_r >= 2 and touch_s >= 2)
        near_break = strict and (pos > 0.85 or pos < 0.15)
        score = (1 - wR / w10) * 3.0
        score += max(0.0, (MAX_RIGHT_W_ATR - wR / atr)) * 0.3
        if vol_shrink < 0.8:
            score += 0.5
        if 0.1 <= pos <= 0.9:
            score += 0.3
        if status == "broke_up":
            score += 1.0
        elif status == "broke_down":
            score -= 1.0
        cand = {
            "window": W, "shape": shape, "status": status,
            "score": round(score, 2), "conv_ratio": round(wR / w10, 2),
            "right_width_atr": round(wR / atr, 2),
            "top_now": round(tR, 2), "bot_now": round(bR, 2),
            "close": round(cur, 2), "atr": round(atr, 2),
            "price_pos": round(pos, 2), "days_to_apex": days_to_apex,
            "vol_shrink": round(vol_shrink, 2),
            "touch_r": touch_r, "touch_s": touch_s, "broke": broke,
            "strict": strict, "near_break": near_break,
        }
        if best is None or cand["score"] > best["score"]:
            best = cand
    return best


# ---------------------------------------------------------------------------
# 全市场扫描
# ---------------------------------------------------------------------------

def _em_get(url: str, params: dict, timeout: int = 12) -> dict:
    """东财接口：push2 不可达时降级 push2delay（延迟行情对日K/列表场景足够）。"""
    import requests
    last_err: Exception | None = None
    for host in ("push2.eastmoney.com", "push2delay.eastmoney.com"):
        try:
            r = requests.get(f"https://{host}{url}", params=params,
                             headers={"User-Agent": astock.UA}, timeout=timeout)
            return r.json()
        except Exception as e:
            last_err = e
    raise last_err  # type: ignore[misc]


def _is_hs_a_share(code: str) -> bool:
    """沪深主板/创业板/科创板 A 股（剔除北交所、指数、基金、B 股、999）。"""
    if len(code) != 6:
        return False
    return code.startswith(("60", "68", "00", "30"))


_POOL_CACHE: tuple[float, list[tuple[str, str]]] | None = None
_POOL_TTL = 6 * 3600  # 股票池当天不变，缓存 6 小时（baostock 登录握手 17s，不值得每次拉）


def _stock_pool() -> list[tuple[str, str]]:
    """全部沪深 A 股 [(code, name)]（带 6 小时缓存）。

    主源 baostock.query_stock_industry：离线行情库，含 code+name，沪深段齐全
    （实测 5553 只，6/0/3 段完整，不受腾讯/东财 HTTP 风控影响）。
    兜底 mootdx.stocks()：本地表（个别市场可能不全，仅作 baostock 不可用时降级）。
    """
    global _POOL_CACHE
    if _POOL_CACHE and time.time() - _POOL_CACHE[0] < _POOL_TTL:
        return _POOL_CACHE[1]
    pool = _stock_pool_baostock()
    if not pool:
        pool = _stock_pool_mootdx()
    if pool:
        _POOL_CACHE = (time.time(), pool)
    return pool


def _stock_pool_baostock() -> list[tuple[str, str]]:
    try:
        import baostock as bs
    except Exception:
        return []
    lg = bs.login()
    if getattr(lg, "error_code", "1") != "0":
        return []
    try:
        rs = bs.query_stock_industry()
        rows = []
        while rs.next():
            rows.append(rs.get_row_data())
    finally:
        bs.logout()
    # 行: updateDate, code(sh.600000), code_name, industry, industryClassification
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for r in rows:
        full = str(r[1])
        if full.startswith(("sh.60", "sh.68", "sz.00", "sz.30")):
            code = full.split(".")[-1]
            if code not in seen:
                seen.add(code)
                out.append((code, str(r[2])))
    return out


def _stock_pool_mootdx() -> list[tuple[str, str]]:
    """兜底：mootdx 本地表 + 腾讯名称。该表个别市场可能不全，仅作降级。"""
    try:
        client = astock._mootdx_client()
        result = client.stocks()
    except Exception:
        return []
    codes: set[str] = set()
    names: dict[str, str] = {}
    frames = result.values() if isinstance(result, dict) else ([result] if result is not None else [])
    for frame in frames:
        try:
            for _, row in frame.iterrows():
                code = str(row.get("code", "")).zfill(6)
                if _is_hs_a_share(code):
                    codes.add(code)
                    nm = row.get("name")
                    if nm:
                        names[code] = str(nm)
        except (AttributeError, TypeError):
            continue
    code_list = sorted(codes)
    if not code_list:
        return []
    # 名称缺的用腾讯批量行情补
    missing = [c for c in code_list if c not in names]
    for i in range(0, len(missing), 80):
        try:
            q = astock.tencent_quote(missing[i:i + 80])
            for c, d in q.items():
                if d.get("name"):
                    names[c] = d["name"]
        except Exception:
            pass
    return [(c, names.get(c, "")) for c in code_list]


def _tencent_klines(code: str, days: int = 300) -> list[list]:
    """腾讯日 K（前复权）。qfqday 为分红股实际返回 key（见 trading-strategies FIX-57）。"""
    prefix = astock.get_prefix(code)
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={prefix}{code},day,,,{days},qfq"
    req = urllib.request.Request(url, headers={"User-Agent": astock.UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    node = (data.get("data") or {}).get(f"{prefix}{code}") or {}
    k = node.get("qfqday") or node.get("day") or []
    if not k:
        raise ValueError(f"tencent kline empty for {code}")
    return [list(x[:6]) for x in k if len(x) >= 6]


def _em_klines(code: str, days: int = 300) -> list[list]:
    """东财日 K（前复权）—— 腾讯限流时的主备源。volume 单位=手。"""
    secid = ("1." if code.startswith(("6", "9")) else "0.") + code
    params = {"secid": secid, "fields1": "f1,f2,f3,f4,f5,f6",
              "fields2": "f51,f52,f53,f54,f55,f56,f57",
              "klt": "101", "fqt": "1", "end": "20500101", "lmt": str(days)}
    data = _em_get("/api/qt/stock/kline/get", params, timeout=15).get("data") or {}
    klines = data.get("klines") or []
    if not klines:
        raise ValueError(f"em kline empty for {code}")
    rows = []
    for line in klines:
        p = line.split(",")
        # date,open,close,high,low,volume,amount
        rows.append([p[0], float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[5])])
    return rows


# baostock 全局单连接（不能多线程并发，加锁串行化 + 断线重登）
_BS_LOCK = threading.Lock()
_BS_LOGGED_IN = False


def _bs_klines(code: str, days: int = 300) -> list[list]:
    """baostock 日 K（前复权）—— 腾讯/东财全限流时的最后兜底源。

    走独立 TCP 协议，不受 HTTP IP 风控影响。单连接串行（锁保护），
    单只 ~0.2s，全市场 ~8 分钟。慢但能保证极端情况出结果。
    """
    from datetime import datetime, timedelta
    import baostock as bs
    with _BS_LOCK:
        global _BS_LOGGED_IN
        for attempt in (1, 2):
            try:
                if not _BS_LOGGED_IN:
                    lg = bs.login()
                    if getattr(lg, "error_code", "1") != "0":
                        raise RuntimeError("baostock login failed")
                    _BS_LOGGED_IN = True
                prefix = "sh" if code.startswith(("6", "9")) else "sz"
                end = datetime.now().strftime("%Y-%m-%d")
                start = (datetime.now() - timedelta(days=int(days * 1.6) + 60)).strftime("%Y-%m-%d")
                rs = bs.query_history_k_data_plus(
                    f"{prefix}.{code}", "date,open,close,high,low,volume",
                    start_date=start, end_date=end, frequency="d", adjustflag="2")
                rows = []
                while rs.next():
                    r = rs.get_row_data()
                    # date, open, close, high, low, volume (str)
                    try:
                        rows.append([r[0], float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])])
                    except (ValueError, TypeError):
                        continue
                if rows:
                    return rows[-days:]
                raise ValueError(f"baostock kline empty for {code}")
            except Exception:
                if attempt == 2:
                    raise
                _BS_LOGGED_IN = False
                try:
                    bs.logout()
                except Exception:
                    pass
    return []


# ── easy_tdx（通达信协议新实现，主源）─────────────────────────────
# FIX-60 (2026-09-15): tdxpy 0.2.7（mootdx 底层）与现通达信服务器协议不兼容，
# K线/实时行情全池静默空（a-stock-data issue #52）。easy_tdx 1.1.0 实测正常：
# 并发 ~30ms/只、创业板/科创板正常、TCP 协议不触发 IP 风控。
# 已知坑: MacClient 建连写 ~/.easy 缓存有并发竞态（偶发 FileNotFoundError），
# 失败重建连接重试一次即可，故 _etdx_client 线程本地 + _etdx_klines 带重试。
_ETDX_TLS = threading.local()


def _etdx_client():
    c = getattr(_ETDX_TLS, "client", None)
    if c is None:
        from easy_tdx import MacClient
        c = MacClient.from_best_host()
        _ETDX_TLS.client = c
    return c


def _etdx_klines(code: str, days: int = 300) -> list[list]:
    """easy_tdx 日 K（前复权）→ [[date, open, close, high, low, volume], ...]。
    与腾讯/东财/baostock 同列序。建连竞态时重建客户端重试一次。
    """
    from easy_tdx import Period, Adjust
    market = 1 if code.startswith(("5", "6", "9")) else 0
    for attempt in (1, 2):
        try:
            c = _etdx_client()
            df = c.get_stock_kline(market, code, period=Period.DAILY,
                                   count=days, adjust=Adjust.QFQ)
            if df is None or df.empty:
                raise ValueError(f"etdx kline empty for {code}")
            return [[str(r["datetime"])[:10], float(r["open"]), float(r["close"]),
                     float(r["high"]), float(r["low"]), float(r["vol"])]
                    for _, r in df.iterrows()]
        except Exception:
            if attempt == 2:
                raise
            _ETDX_TLS.client = None  # 重建客户端(缓存竞态恢复)
    return []


def _klines(code: str, days: int = 300) -> list[list]:
    """K线链: easy_tdx 主源(通达信TCP, 并发~30ms/只, 不触发IP风控)
    → 腾讯 → 东财 → baostock(串行兜底)。
    """
    try:
        return _etdx_klines(code, days)
    except Exception:
        pass
    _KLINE_LIMITER.wait()
    try:
        return _tencent_klines(code, days)
    except Exception:
        pass
    _KLINE_LIMITER.wait()
    try:
        return _em_klines(code, days)
    except Exception:
        pass
    return _bs_klines(code, days)


# 腾讯健康度熔断标志：扫描前探测一次，全局限流态下切 baostock 主源
_TENCENT_HEALTHY = True


def _probe_tencent() -> bool:
    """用一只活跃股探测腾讯 K 线是否可用，设置全局熔断标志。

    成功 → _TENCENT_HEALTHY=True（快路径，并发）；
    失败 → False（熔断，baostock 串行主源）。探测本身不触发限流（单次）。
    """
    global _TENCENT_HEALTHY
    for probe in ("300902", "600519", "000001"):
        try:
            kl = _tencent_klines(probe, 30)
            if kl and len(kl) >= 10:
                _TENCENT_HEALTHY = True
                return True
        except Exception:
            continue
    _TENCENT_HEALTHY = False
    return False


_SCANNING = False
_SCAN_LOCK = threading.Lock()
_SCAN_THREAD: threading.Thread | None = None


def _scan() -> dict:
    t0 = time.time()
    # 扫描前探测一次腾讯健康度：健康走快路径(并发)，限流熔断走 baostock 串行主源
    tencent_ok = _probe_tencent()
    pool = _stock_pool()
    # ST/退市剔除
    pool = [(c, nm) for c, nm in pool if "ST" not in nm.upper() and "退" not in nm]
    codes = [c for c, _ in pool]
    names = dict(pool)

    # 批量实时行情（名称/现价/市值），80 只/批
    quotes: dict[str, dict] = {}
    for i in range(0, len(codes), 80):
        batch = codes[i:i + 80]
        try:
            quotes.update(astock.tencent_quote(batch))
        except Exception:
            pass
        time.sleep(0.15)

    # 预筛：市值 5~300 亿（形态扫描对超大盘无意义、对微盘噪音多）
    eligible = [c for c in codes
                if (quotes.get(c, {}).get("mcap_yi") or 0) >= 5
                and (quotes.get(c, {}).get("mcap_yi") or 999) <= 300]

    from concurrent.futures import ThreadPoolExecutor, as_completed
    rows: list[dict] = []
    errors = 0

    def work(code: str):
        try:
            kl = _klines(code)
            if len(kl) < 60:
                return None
            d = detect(kl)
            if not d:
                return None
            q = quotes.get(code, {})
            return {
                "code": code, "name": names.get(code, q.get("name", "")),
                "price": q.get("price") or d["close"],
                "mcap_yi": round(q.get("mcap_yi") or 0, 1),
                "change_pct": q.get("change_pct"),
                **d,
            }
        except Exception:
            return "err"

    with ThreadPoolExecutor(max_workers=KLINE_WORKERS) as ex:
        for r in ex.map(work, eligible):
            if r is None:
                continue
            if isinstance(r, str):
                errors += 1
            else:
                rows.append(r)

    strict = [r for r in rows if r["strict"]]
    strict.sort(key=lambda r: (-r["near_break"], -r["score"]))
    all_rows = [r for r in rows if not r["strict"]]
    all_rows.sort(key=lambda r: -r["score"])
    now = time.strftime("%Y-%m-%d %H:%M", time.localtime())
    return {
        "updated": now,
        "scanned": len(eligible),
        "pool_total": len(pool),
        "quote_failed": len(codes) - len(quotes),
        "kline_errors": errors,
        "hits": len(rows),
        "strict_count": len(strict),
        "near_break_count": sum(1 for r in strict if r["near_break"]),
        "duration_s": round(time.time() - t0, 1),
        "kline_path": "tencent_fast" if tencent_ok else "baostock_serial",
        "stocks": strict[:MAX_REPORT],
        "candidates": all_rows[:20],
        "note": ("仅客观形态数据：包络通道收敛+缩量+双侧触边+未破位。"
                 "非推荐、非预测，不构成投资建议；形态最终确认仍需人工看图。"),
    }


def _scan_status() -> dict:
    with _LOCK:
        hit = _CACHE.get("triangles")
        if hit:
            return {"state": "ready", "updated": hit[1].get("updated"), "age_s": round(time.time() - hit[0])}
    if _SCANNING:
        return {"state": "scanning"}
    return {"state": "cold"}


def start_scan_if_idle() -> bool:
    """冷启动时拉起后台扫描线程；已有缓存/正在扫则不重复。返回是否新起了线程。"""
    global _SCANNING, _SCAN_THREAD
    with _SCAN_LOCK:
        if _SCANNING:
            return False
        _SCANNING = True
        _SCAN_THREAD = threading.Thread(target=_run_scan_bg, daemon=True)
        _SCAN_THREAD.start()
        return True


def _run_scan_bg():
    """后台扫描。内层再开一个线程跑 _scan()，外层 join 硬超时 300s：
    数据源全挂（腾讯+东财同时限流）导致 _scan 卡死时优雅放弃本轮，
    下次请求自动重启。"""
    global _SCANNING
    result_box: dict = {}

    def _run():
        try:
            result_box["val"] = _scan()
        except Exception as e:
            result_box["err"] = e

    th = threading.Thread(target=_run, daemon=True)
    th.start()
    # baostock 主源串行 ~0.25s/只 × 2500 ≈ 10 分钟（锁内排队），留足余量到 25 分钟
    th.join(timeout=1500)
    if th.is_alive():
        # 超时：扫描卡死（数据源全限流），放弃本轮，留错误提示
        with _LOCK:
            _CACHE["triangles_error"] = (time.time(), "K线数据源暂不可用（腾讯/东财限流），请稍后点「重新扫描」重试")
        with _SCAN_LOCK:
            _SCANNING = False
        return
    val = result_box.get("val")
    if val is not None and (val.get("hits") or val.get("scanned", 0) == 0):
        with _LOCK:
            _CACHE["triangles"] = (time.time(), val)
            _CACHE.pop("triangles_error", None)
    with _SCAN_LOCK:
        _SCANNING = False


def get_triangles(force: bool = False) -> dict:
    """扫描入口（立即返回，不阻塞）：

    - 有新鲜缓存且非 force → 返回数据（state=ready）
    - 缓存缺失/过期（含 force 重扫、冷启动首扫）→ 拉起后台扫描（若尚未在扫）
      有旧缓存则返回旧数据 + stale=true，无缓存则返回 state=scanning，前端轮询 /status 直到 ready。
    """
    with _LOCK:
        hit = _CACHE.get("triangles")
        fresh = hit is not None and time.time() - hit[0] < _TTL
    if fresh and not force:
        assert hit is not None
        return {**hit[1], "state": "ready"}
    # force 重扫 或 缓存缺失/过期 → 拉起后台扫描（已在扫则不重复）
    start_scan_if_idle()
    if hit is not None:
        # 有旧数据：force 时标 stale 让前端知道在重扫；非 force（过期）同理
        return {**hit[1], "state": "ready", "stale": True}
    return status()


def status() -> dict:
    """前端轮询用：state=ready(附数据)/scanning/cold/error。

    数据源全限流导致扫描超时放弃时，把 error 提示透传给前端（前端据此提示"重新扫描"）。
    """
    st = _scan_status()
    with _LOCK:
        err = _CACHE.get("triangles_error")
        hit = _CACHE.get("triangles")
    if st["state"] == "ready" and hit:
        data = {**hit[1], "state": "ready"}
        # ready 时也带出旧错误（若有，且无新鲜数据前）
        return data
    if err and st["state"] != "ready":
        st = {**st, "state": "error", "error": err[1]}
    return st
