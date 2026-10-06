-- =============================================================
-- 003: 옛 app_settings 테이블 삭제
--
-- 002 실행 + 코드 배포 후, 설정 페이지와 스캔 화면이 정상 동작하는 것을
-- 확인한 다음에 실행한다. 되돌릴 수 없으므로 서두르지 않아도 된다.
--
-- 실행 전 확인: 아래 두 쿼리의 결과가 같아야 한다.
--   SELECT count(*) FROM app_settings;
--   SELECT count(*) FROM production_app_settings
--    WHERE settings_key IN ('first_qr_length', 'second_qr_length');
-- =============================================================

DROP TABLE IF EXISTS app_settings;
