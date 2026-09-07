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

사이트는 **완전한 정적 페이지**입니다. 매일 GitHub Actions가 데이터를 받아
`public/data/*.json` 으로 굽고 사이트를 통째로 재배포합니다. 브라우저는 같은
오리진의 JSON만 읽으므로 CORS 문제가 없고, 서버를 돌릴 필요도 없습니다.

`scripts/build-data.mjs` 가 두 파일을 만듭니다.

### `public/data/stocks.json` — 주가

Yahoo Finance 차트 API의 **수정종가**(adjusted close) 10년치. 종목 정의는
`data/tickers.json` 한 곳에 있고, 앱과 수집 스크립트가 같이 읽습니다. 종목을
추가하려면 여기에 한 줄 넣으면 됩니다.

일부 종목을 못 받아와도 나머지는 그대로 그려지고, 실패한 종목은 화면 상단
경고로 표시됩니다.

### `public/data/memory.json` — 현물가

기본값은 `data/memory-spot.csv` 이고, 스키마는 다음과 같습니다.

```csv
date,series,price,unit,source
2026-09-05,DRAM_DDR4_8Gb,6.99,USD/chip,dramexchange
```

- `date`: `YYYY-MM-DD`. 일별·월별 어느 쪽이든 됩니다.
- `series`: `DRAM_DDR4_8Gb` / `DRAM_DDR5_16Gb` / `NAND_512Gb_TLC` / `NAND_128Gb_MLC`
  (라벨은 `src/lib/tickers.ts` 의 `MEMORY_LABELS`)
- `source`: 출처. `PLACEHOLDER` 인 행이 하나라도 있으면 그 계열 전체가
  경고 배너 + 점선으로 표시됩니다.

유료·사내 피드를 쓴다면 리포지토리 변수 `MEMORY_API_URL` (필요시 시크릿
`MEMORY_API_KEY`) 을 설정하세요. 그 URL을 CSV 대신 호출하고, 실패하면 자동으로
CSV로 폴백합니다. 응답은 `{ "series": Series[] }` 형태여야 하며 타입은
`src/lib/types.ts` 참고.

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

`.github/workflows/deploy.yml` 이 평일 01:10 UTC(10:10 KST)에 이 스크립트를
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

## 배포 (GitHub Pages)

`.github/workflows/deploy.yml` 하나가 데이터 갱신과 배포를 다 합니다.

1. DRAMeXchange 현물가 수집 → 변경이 있으면 CSV 커밋·푸시
2. `scripts/build-data.mjs` 로 주가·현물가 JSON 생성
3. `next build` (정적 export) → GitHub Pages 배포

평일 09:10 UTC(18:10 KST)에 자동 실행되고, push 할 때와 Actions 탭의
**Run workflow** 로도 돕니다. 공개 리포지토리라 배포된 링크는 로그인 없이
누구나 열 수 있습니다.

### 최초 1회 설정

리포지토리 **Settings → Pages → Build and deployment → Source** 를
**GitHub Actions** 로 바꿔주세요. 이 한 번만 하면 이후는 전부 자동입니다.
(`Settings → Actions → General → Workflow permissions` 가 *Read and write*
여야 CSV 커밋이 됩니다.)

다른 곳에 올리고 싶다면 Vercel도 그대로 됩니다. 저장소를 연결해 기본 설정으로
배포하면 되고, 이때는 `NEXT_PUBLIC_BASE_PATH` 를 비워두면 됩니다.

## 구조

```
data/memory-spot.csv          현물가 원본 데이터
scripts/fetch-dramexchange.mjs  DRAMeXchange 수집 스크립트
scripts/dramexchange-map.json   품목명 → series 매핑
data/tickers.json             종목 정의 (앱·스크립트 공용)
scripts/build-data.mjs        public/data/*.json 생성 (주가 + 현물가)
src/components/Chart.tsx      ECharts 라인 차트
src/lib/normalize.ts          기간 자르기 · 기준일=100 환산
src/lib/tickers.ts            색상 · 라벨 정의
```
