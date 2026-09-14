# RYM Tracker

저장한 Rate Your Music 곡·앨범 차트를 주차별로 비교하는 Next.js 앱입니다. GitHub의 `public/` 차트 파일을 실행 중에 읽으므로 기록 변경은 다음 조회부터 반영됩니다.

## 실행

```bash
npm ci
npm run dev
```

`.env.local` 또는 배포 환경에 기존 설정을 넣습니다. 토큰은 클라이언트에 노출하지 않습니다.

| 환경변수 | 용도 |
| --- | --- |
| `RYM_GITHUB_TOKEN` | 해당 저장소 Contents 읽기·쓰기 권한을 가진 토큰 |
| `GITHUB_OWNER` | 저장소 소유자 |
| `GITHUB_REPO` | 저장소 이름 |
| `GITHUB_BRANCH` | 기록을 읽고 저장할 브랜치, 기본 `main` |
| `ADMIN_PASSWORD` | `admin/pin.json`이 없을 때만 사용하는 초기 4자리 PIN; 기본값 없음 |
| `ADMIN_SESSION_SECRET` | 선택: 관리자 쿠키 서명용 고정 비밀값; 생략 시 GitHub 토큰 사용 |
| `ADMIN_PIN_PEPPER` | 선택: 새 PIN 해시 보호용 고정 비밀값; 생략 시 GitHub 토큰 사용 |

미리보기 배포에서 관리자 기능을 실제로 사용할 때도 `GITHUB_BRANCH`가 가리키는 저장소에 기록됩니다. 테스트 브랜치로 별도 설정하지 않았다면 실제 기록이 바뀝니다.

## 검증

```bash
npm run lint -- --max-warnings=0
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

브라우저 테스트는 로컬 서버를 직접 시작하고, 차트 API와 Spotify 응답을 테스트 데이터로 대체합니다. 실제 GitHub 파일을 업로드·삭제하지 않습니다. 실행 중인 서버는 `TEST_BASE_URL`, 별도 Chromium은 `CHROMIUM_EXECUTABLE_PATH`로 지정할 수 있습니다.

## 코드 위치

| 위치 | 책임 |
| --- | --- |
| `app/page.tsx` | 서버 페이지 진입점 |
| `app/components/TrackerHome.tsx` | 비교 선택, 검색, 관리자 작업 연결 |
| `app/components/ChartPane.tsx` | 차트 선택과 목록, 기록 로딩/오류 |
| `app/components/SnapshotCalendar.tsx` | UTC 기준 주차 선택 |
| `app/components/SongCard.tsx`, `SpotifyPlayer.tsx` | 음악 카드와 미리듣기 |
| `app/components/AdminDialog.tsx` | 로그인·PIN 변경, 키보드 포커스 |
| `app/hooks/` | 비동기 기록 조회와 브라우저 동작 |
| `app/lib/chartModel.ts` | 서버·브라우저 공통 형식 검사와 차트 규칙 |
| `app/lib/chartStore.ts`, `github.ts` | GitHub 조회와 SHA별 메타데이터 캐시 |
| `app/lib/adminAuth.ts`, `http.ts` | 인증·요청 검사·오류 응답 |
| `app/api/*/route.ts` | API 입출력 연결 |
| `app/styles/tracker.css` | 화면 전체 스타일과 반응형 규칙 |

변경 사항과 운영상 제한은 [점검 기록](docs/review.md)에 정리했습니다.
