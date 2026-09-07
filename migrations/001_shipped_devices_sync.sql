-- =============================================================
-- 마이그레이션: shipped_devices 출하 동기화 (기존 DB에 적용)
--
-- supabase_setup.sql 의 [출하 동기화] 섹션과 내용이 동일하다.
-- 이미 운영 중인 DB에는 이 파일만 SQL Editor에서 실행하면 된다.
-- (supabase_setup.sql 전체는 신규 DB 초기 구축용)
--
-- 재실행해도 안전하다.
-- =============================================================

-- =============================================================
-- [출하 동기화] production_records → shipped_devices
-- 생산 기록 저장 시 Solity SN을 출하 테이블에 동일 트랜잭션으로 기록한다.
-- 이 프로젝트는 K100 생산용이므로 model은 'K100' 고정.
-- =============================================================

-- 9. shipped_devices 구조 보강
--    기존 19,036행은 그대로 두고 컬럼만 추가한다.
ALTER TABLE shipped_devices ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE shipped_devices ADD COLUMN IF NOT EXISTS deleted_at TEXT DEFAULT NULL;
ALTER TABLE shipped_devices ADD COLUMN IF NOT EXISTS record_id BIGINT
    REFERENCES production_records(id) ON DELETE SET NULL;

-- sn 중복 방지 (동기화를 멱등하게 만들기 위해 필수)
ALTER TABLE shipped_devices DROP CONSTRAINT IF EXISTS shipped_devices_sn_key;
ALTER TABLE shipped_devices ADD CONSTRAINT shipped_devices_sn_key UNIQUE (sn);

CREATE INDEX IF NOT EXISTS idx_shipped_devices_record_id
    ON shipped_devices (record_id);

-- [권한] anon 키에는 읽기만 허용한다.
--   쓰기는 아래 SECURITY DEFINER RPC를 통해서만 이루어진다.
ALTER TABLE shipped_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on shipped_devices" ON shipped_devices;
DROP POLICY IF EXISTS "Read-only shipped_devices" ON shipped_devices;
CREATE POLICY "Read-only shipped_devices"
    ON shipped_devices FOR SELECT
    USING (true);

-- 테이블 레벨에서도 쓰기 권한 회수 (RLS와 이중 방어)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON shipped_devices FROM anon, authenticated;
GRANT SELECT ON shipped_devices TO anon, authenticated;


-- 10. 생산 시각 문자열('YYYY-MM-DD HH:MM:SS')에서 출하 배치 정보를 유도하는 헬퍼
--     batch_id는 'YYMMDD', shipped_date는 기존 데이터 형식인 'YYYY/M/D'를 따른다.
CREATE OR REPLACE FUNCTION _shipped_batch_of(p_production_time TEXT)
RETURNS TABLE (batch_id TEXT, shipped_date TEXT) AS $$
DECLARE
    v_date DATE;
BEGIN
    v_date := substring(p_production_time FROM 1 FOR 10)::DATE;
    RETURN QUERY SELECT
        to_char(v_date, 'YYMMDD'),
        to_char(v_date, 'FMYYYY/FMMM/FMDD');
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- 11. RPC 함수(교체): 매칭 저장 시 shipped_devices까지 동일 트랜잭션으로 기록
CREATE OR REPLACE FUNCTION create_production_match(
    p_lumi_sn TEXT,
    p_solity_sn TEXT,
    p_production_time TEXT,
    p_operator_name TEXT,
    p_note TEXT
) RETURNS jsonb AS $$
DECLARE
    v_record_id BIGINT;
    v_batch RECORD;
    v_result jsonb;
BEGIN
    -- 1. production_records에 삽입
    INSERT INTO production_records (lumi_sn, solity_sn, production_time, operator_name, note)
    VALUES (p_lumi_sn, p_solity_sn, p_production_time, p_operator_name, p_note)
    RETURNING id INTO v_record_id;

    -- 2. used_sn_codes에 삽입
    INSERT INTO used_sn_codes (sn_value, record_id, sn_role)
    VALUES
        (p_lumi_sn, v_record_id, 'lumi'),
        (p_solity_sn, v_record_id, 'solity');

    -- 3. shipped_devices에 Solity SN 기록
    --    이미 존재하는 SN이면 배치/출하일 등 기존 출하 정보는 보존하고
    --    생산 기록과의 연결만 갱신한다(삭제되었던 행은 되살린다).
    SELECT * INTO v_batch FROM _shipped_batch_of(p_production_time);
    INSERT INTO shipped_devices (sn, model, batch_id, shipped_date, record_id)
    VALUES (p_solity_sn, 'K100', v_batch.batch_id, v_batch.shipped_date, v_record_id)
    ON CONFLICT (sn) DO UPDATE
        SET record_id = EXCLUDED.record_id,
            deleted_at = NULL;

    -- 4. 결과 반환값 구성
    v_result := jsonb_build_object(
        'id', v_record_id,
        'lumi_sn', p_lumi_sn,
        'solity_sn', p_solity_sn,
        'production_time', p_production_time,
        'operator_name', p_operator_name,
        'note', p_note
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- 12. RPC 함수(신규): 매칭 수정을 원자적으로 처리
--     기존 Python 코드는 UPDATE + DELETE + INSERT를 개별 호출해 원자성이 없었다.
CREATE OR REPLACE FUNCTION update_production_match(
    p_record_id BIGINT,
    p_lumi_sn TEXT,
    p_solity_sn TEXT,
    p_operator_name TEXT,
    p_note TEXT
) RETURNS jsonb AS $$
DECLARE
    v_row production_records%ROWTYPE;
    v_batch RECORD;
BEGIN
    UPDATE production_records
       SET lumi_sn = p_lumi_sn,
           solity_sn = p_solity_sn,
           operator_name = p_operator_name,
           note = p_note
     WHERE id = p_record_id
       AND deleted_at IS NULL
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- used_sn_codes 갱신
    DELETE FROM used_sn_codes WHERE record_id = p_record_id;
    INSERT INTO used_sn_codes (sn_value, record_id, sn_role)
    VALUES
        (p_lumi_sn, p_record_id, 'lumi'),
        (p_solity_sn, p_record_id, 'solity');

    -- Solity SN이 바뀐 경우 이전 출하 행은 연결 해제 후 소프트 삭제
    UPDATE shipped_devices
       SET deleted_at = to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
           record_id = NULL
     WHERE record_id = p_record_id
       AND sn <> p_solity_sn;

    SELECT * INTO v_batch FROM _shipped_batch_of(v_row.production_time);
    INSERT INTO shipped_devices (sn, model, batch_id, shipped_date, record_id)
    VALUES (p_solity_sn, 'K100', v_batch.batch_id, v_batch.shipped_date, p_record_id)
    ON CONFLICT (sn) DO UPDATE
        SET record_id = EXCLUDED.record_id,
            deleted_at = NULL;

    RETURN to_jsonb(v_row);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- 13. RPC 함수(신규): 매칭 소프트 삭제를 원자적으로 처리
CREATE OR REPLACE FUNCTION delete_production_match(
    p_record_id BIGINT,
    p_deleted_at TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_found BOOLEAN;
BEGIN
    UPDATE production_records
       SET deleted_at = p_deleted_at
     WHERE id = p_record_id
    RETURNING TRUE INTO v_found;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- SN 재사용이 가능하도록 사용 이력에서 해제
    DELETE FROM used_sn_codes WHERE record_id = p_record_id;

    -- 출하 행도 함께 소프트 삭제
    UPDATE shipped_devices
       SET deleted_at = p_deleted_at
     WHERE record_id = p_record_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- 13-1. SECURITY DEFINER 함수 실행 권한 명시
--   기본값은 PUBLIC 실행 허용이므로, 필요한 롤로만 좁힌다.
-- 내부 헬퍼는 REST API로 노출할 필요가 없다.
REVOKE ALL ON FUNCTION _shipped_batch_of(TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION create_production_match(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_production_match(BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_production_match(BIGINT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_production_match(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_production_match(BIGINT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_production_match(BIGINT, TEXT) TO anon, authenticated;


-- 14. 기존 생산 기록 백필 (재실행해도 안전)
--     이미 출하 테이블에 있는 SN은 기존 출하 정보를 유지한 채 연결만 맺는다.
INSERT INTO shipped_devices (sn, model, batch_id, shipped_date, record_id)
SELECT pr.solity_sn,
       'K100',
       b.batch_id,
       b.shipped_date,
       pr.id
  FROM production_records pr
 CROSS JOIN LATERAL _shipped_batch_of(pr.production_time) b
 WHERE pr.deleted_at IS NULL
ON CONFLICT (sn) DO UPDATE
    SET record_id = EXCLUDED.record_id,
        deleted_at = NULL;
