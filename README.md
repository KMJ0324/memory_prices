# memory_prices

DRAM · NAND 현물가와 메모리 반도체 종목 주가를 한 차트에 겹쳐 보는 Next.js 앱.

- **현물가**: DRAM DDR4 8Gb, DDR5 16Gb, NAND 512Gb TLC, NAND 128Gb MLC
- **주가**: 삼성전자(005930.KS), 삼성전자우(005935.KS), SK하이닉스(000660.KS), 마이크론(MU)

## 실행

```bash
npm install
npm run dev     # http://localhost:3000
```

## 차트 사용법

- **기간**: 1년 / 3년 / 5년 / 10년 / 전체
- **기준일 = 100**: 각 계열의 화면 내 첫 값을 100으로 환산한 상대 지수. 원화 주가·달러 주가·달러 칩 가격을 한 축에서 비교할 수 있어 기본값입니다.
- **실제 가격**: 통화·단위별로 축이 분리됩니다(현물가 USD / 주가 원 / 주가 USD).
- 범례 칩을 눌러 계열을 켜고 끄고, 하단 슬라이더나 휠로 구간을 확대할 수 있습니다.
- **점선**으로 그려진 계열은 아직 검증되지 않은 샘플(`PLACEHOLDER`) 데이터입니다.

## 데이터

### 주가 — `/api/stocks`

Yahoo Finance 차트 API의 **수정종가**(adjusted close)를 서버에서 받아옵니다. 서버 경유라
브라우저 CORS 제약이 없고, 15분 캐시(ISR)가 걸려 있습니다. 종목 추가·변경은
`src/lib/tickers.ts` 의 `TICKERS` 배열만 고치면 됩니다.

일부 종목을 못 받아와도 나머지는 그대로 그려지고, 실패한 종목은 화면 상단 경고로 표시됩니다.

### 현물가 — `/api/memory`

DRAM/NAND 현물가는 무료 공개 API가 없어 두 가지 경로를 지원합니다.

1. **`data/memory-spot.csv`** (기본). 스키마는 다음과 같습니다.

   ```csv
   date,series,price,unit,source
   2026-09-05,DRAM_DDR4_8Gb,6.99,USD/chip,dramexchange
   ```

   - `date`: `YYYY-MM-DD`. 일별·월별 어느 쪽이든 됩니다.
   - `series`: `DRAM_DDR4_8Gb` / `DRAM_DDR5_16Gb` / `NAND_512Gb_TLC` / `NAND_128Gb_MLC`
     (라벨은 `src/lib/tickers.ts` 의 `MEMORY_LABELS`)
   - `source`: 출처. `PLACEHOLDER` 인 행이 하나라도 있으면 그 계열 전체가
     경고 배너 + 점선으로 표시됩니다.

2. **외부 엔드포인트**. `MEMORY_API_URL` 환경변수를 설정하면 CSV 대신 그 URL을
   호출합니다(선택적으로 `MEMORY_API_KEY` 를 Bearer 토큰으로 붙임). 응답은
   `{ "series": Series[] }` 형태여야 하며, 타입은 `src/lib/types.ts` 참고.
   호출이 실패하면 자동으로 CSV로 폴백하고 경고를 띄웁니다.

## 현물가 자동 갱신 (DRAMeXchange)

`scripts/fetch-dramexchange.mjs` 가 https://www.dramexchange.com 의 현물가 표를 파싱해
`data/memory-spot.csv` 에 그날 행을 upsert 합니다. 같은 날 여러 번 돌려도 중복되지 않습니다.

```bash
node scripts/fetch-dramexchange.mjs                      # 수집 후 CSV 갱신
node scripts/fetch-dramexchange.mjs --dry-run            # 파싱 결과만 출력
node scripts/fetch-dramexchange.mjs --dump raw.html      # 받아온 HTML 저장
node scripts/fetch-dramexchange.mjs --html raw.html      # 저장된 HTML로 오프라인 파싱
node scripts/fetch-dramexchange.mjs --drop-placeholders  # 시드 샘플 행 일괄 제거
```

품목명 → `series` 매핑은 **`scripts/dramexchange-map.json`** 에 정규식으로 들어 있습니다.
사이트 표기가 바뀌어 하나도 매칭되지 않으면 스크립트가 0이 아닌 코드로 종료하면서
페이지에서 찾은 품목명 목록을 출력하므로, 그걸 보고 `match` 만 고치면 됩니다.

`.github/workflows/update-spot-prices.yml` 이 평일 01:10 UTC(10:10 KST)에 이 스크립트를
돌리고, 변경이 있으면 CSV를 커밋·푸시합니다. 실패하면 받아온 HTML을 아티팩트로 올려
셀렉터를 고칠 수 있게 합니다. 수동 실행은 Actions 탭의 **Run workflow**.

> 이 스크립트는 아직 실제 DRAMeXchange 페이지에 대해 검증되지 않았습니다(개발 환경에서
> 해당 도메인 접근이 차단되어 있었음). 파서는 합성 픽스처로만 테스트했으니, 워크플로를
> 처음 켤 때 `workflow_dispatch` 로 한 번 수동 실행해 결과를 확인하세요. 페이지가
> 자바스크립트로 표를 그리는 구조라면 정적 파싱으로는 잡히지 않으므로 헤드리스 브라우저가
> 필요할 수 있습니다. 스크래핑 전에 대상 사이트의 이용약관과 robots.txt 도 확인하세요.

### `data/memory-spot.csv` 의 시드 값에 대하여

현재 들어 있는 2019-01 ~ 2025-08 월별 값은 **메모리 사이클의 대략적인 모양만 맞춘
손으로 넣은 샘플**이며 실제 시세가 아닙니다. 그래서 전부 `source=PLACEHOLDER` 로 표시되어
있고, UI에서 경고 배너와 점선으로 구분됩니다. 실제 데이터가 쌓이면
`--drop-placeholders` 로 지우세요.

## 배포

Vercel에 그대로 올라갑니다. 저장소를 연결하고 기본 설정으로 배포하면 되며,
외부 현물가 피드를 쓸 때만 `MEMORY_API_URL` (필요시 `MEMORY_API_KEY`) 을
환경변수로 넣으면 됩니다.

## 구조

```
data/memory-spot.csv          현물가 원본 데이터
scripts/fetch-dramexchange.mjs  DRAMeXchange 수집 스크립트
scripts/dramexchange-map.json   품목명 → series 매핑
src/app/api/stocks/route.ts   Yahoo Finance 프록시
src/app/api/memory/route.ts   현물가 (CSV 또는 외부 엔드포인트)
src/components/Chart.tsx      ECharts 라인 차트
src/lib/normalize.ts          기간 자르기 · 기준일=100 환산
src/lib/tickers.ts            종목 · 색상 · 라벨 정의
```
