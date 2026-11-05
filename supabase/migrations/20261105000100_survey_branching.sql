-- アンケートの分岐（前の設問の答えによって、次の設問を出すかを決める）。
--
-- 設問に任意で show_if を持たせる:
--   {"id":"q3","text":"どこで自治会を知りましたか？","type":"single","options":[...],
--    "show_if":{"question_id":"q2","values":["知っている"]}}
--   * 条件元は、その設問より前にある「1つ選ぶ」「複数選ぶ」の設問だけ。
--   * 条件元の答えが values のどれかに当たれば表示する（複数選ぶは、どれか1つ当たれば表示）。
--   * 条件元が非表示なら、その設問も非表示（連鎖）。
--   * 非表示の設問は必須でも回答を求めず、送られてきた回答も保存しない。
--   * show_if のない設問は今までどおり常に表示。既存の企画には影響しない。
-- 引数・戻り値は変えない。
begin;

create or replace function public.validate_survey_answers(p_config jsonb, p_answers jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_q jsonb; v_id text; v_type text; v_val jsonb; v_out jsonb := '{}'::jsonb; v_item jsonb; v_num numeric;
  v_required boolean; v_text text;
  v_visible jsonb := '{}'::jsonb;  -- 設問id -> 表示したか
  v_cond jsonb; v_parent text; v_parent_val jsonb; v_show boolean;
begin
  if p_config is null or jsonb_typeof(p_config->'questions') <> 'array' then
    return v_out;
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    p_answers := '{}'::jsonb;
  end if;

  for v_q in select * from jsonb_array_elements(p_config->'questions') loop
    v_id := v_q->>'id';
    v_type := coalesce(v_q->>'type', 'text');
    v_required := coalesce((v_q->>'required')::boolean, false);
    v_text := coalesce(v_q->>'text', '設問');

    -- 表示条件。前の設問のうち、表示されて回答済みのものだけを見る。
    v_cond := v_q->'show_if';
    v_show := true;
    if v_cond is not null and jsonb_typeof(v_cond) = 'object' then
      v_parent := v_cond->>'question_id';
      v_parent_val := v_out->v_parent;
      if v_parent is null or coalesce((v_visible->>v_parent)::boolean, false) = false
         or v_parent_val is null or jsonb_typeof(v_cond->'values') <> 'array' then
        v_show := false;
      elsif jsonb_typeof(v_parent_val) = 'string' then
        v_show := (v_cond->'values') @> jsonb_build_array(v_parent_val);
      elsif jsonb_typeof(v_parent_val) = 'array' then
        v_show := exists (
          select 1 from jsonb_array_elements(v_parent_val) a
           where (v_cond->'values') @> jsonb_build_array(a.value)
        );
      else
        v_show := false;
      end if;
    end if;

    v_visible := v_visible || jsonb_build_object(v_id, v_show);
    if not v_show then
      continue;
    end if;

    v_val := p_answers->v_id;

    if v_val is null or v_val = 'null'::jsonb
       or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '')
       or (jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 0) then
      if v_required then
        raise exception 'アンケートの「%」に回答してください。', v_text;
      end if;
      continue;
    end if;

    if v_type = 'text' then
      if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 1000 then
        raise exception 'アンケートの「%」は1000文字以内の文章で回答してください。', v_text;
      end if;
      v_out := v_out || jsonb_build_object(v_id, btrim(v_val #>> '{}'));
    elsif v_type = 'single' then
      if jsonb_typeof(v_val) <> 'string' or not (v_q->'options') @> to_jsonb(v_val #>> '{}') then
        raise exception 'アンケートの「%」は選択肢から選んでください。', v_text;
      end if;
      v_out := v_out || jsonb_build_object(v_id, v_val);
    elsif v_type = 'multiple' then
      if jsonb_typeof(v_val) <> 'array' then
        raise exception 'アンケートの「%」は選択肢から選んでください。', v_text;
      end if;
      for v_item in select * from jsonb_array_elements(v_val) loop
        if jsonb_typeof(v_item) <> 'string' or not (v_q->'options') @> to_jsonb(v_item #>> '{}') then
          raise exception 'アンケートの「%」は選択肢から選んでください。', v_text;
        end if;
      end loop;
      v_out := v_out || jsonb_build_object(v_id, v_val);
    elsif v_type = 'rating' then
      begin
        v_num := (v_val #>> '{}')::numeric;
      exception when others then
        raise exception 'アンケートの「%」は1〜5で回答してください。', v_text;
      end;
      if v_num < 1 or v_num > 5 or v_num <> trunc(v_num) then
        raise exception 'アンケートの「%」は1〜5で回答してください。', v_text;
      end if;
      v_out := v_out || jsonb_build_object(v_id, v_num::int);
    end if;
  end loop;

  return v_out;
end $$;

revoke all on function public.validate_survey_answers(jsonb, jsonb) from public, anon;
grant execute on function public.validate_survey_answers(jsonb, jsonb) to authenticated;

commit;
