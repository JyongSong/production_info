-- =============================================================
-- 002: app_settings → production_app_settings (+ Solity SN 규칙 추가)
--
-- 이 Supabase 인스턴스는 여러 프로젝트가 함께 쓴다.
-- 'app_settings'는 이름이 너무 일반적이어서 다른 프로젝트와 충돌할 수 있으므로
-- 이 프로젝트의 다른 테이블과 같은 'production' 접두사를 붙인다.
--
-- 무중단 전환을 위해 이름을 바꾸지 않고 새 테이블로 복사한다.
-- 이 SQL을 실행한 뒤에도 기존 app_settings는 그대로 남아 있으므로
-- 배포 전까지 구버전 코드가 계속 정상 동작한다.
--
-- 실행 순서
--   1) 이 SQL 실행      (구버전 코드는 계속 app_settings 사용 → 영향 없음)
--   2) 코드 배포        (신버전 코드는 production_app_settings 사용)
--   3) 동작 확인 후 003 실행하여 옛 테이블 삭제
-- =============================================================

CREATE TABLE IF NOT EXISTS production_app_settings (
    settings_key TEXT PRIMARY KEY,
    settings_value TEXT NOT NULL
);

-- 기존 설정값을 그대로 가져온다.
INSERT INTO production_app_settings (settings_key, settings_value)
SELECT settings_key, settings_value FROM app_settings
ON CONFLICT (settings_key) DO NOTHING;

-- Solity SN 형식 규칙.
-- 아래 값은 코드에 하드코딩되어 있던 값과 동일하므로 동작은 바뀌지 않는다.
INSERT INTO production_app_settings (settings_key, settings_value) VALUES
    ('solity_sn_length',   '13'),
    ('solity_sn_prefix',   'AK'),
    ('solity_sn_suffixes', 'TAK,TAS')
ON CONFLICT (settings_key) DO NOTHING;

-- anon 키로 접근하므로 RLS 정책이 필요하다 (기존 app_settings와 동일).
ALTER TABLE production_app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on production_app_settings" ON production_app_settings;
CREATE POLICY "Allow all on production_app_settings"
    ON production_app_settings FOR ALL
    USING (true) WITH CHECK (true);

-- 확인용
SELECT settings_key, settings_value FROM production_app_settings ORDER BY settings_key;
