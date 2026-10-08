/* Consultas de operações. Preparado para Supabase JS v2; ainda não ativado no app.js. */
(function (root) {
    'use strict';

    const RECORD_COLUMNS = 'id,operation_type,fazenda,campo,gleba,ano,cultura,produto,status,area_total,area_realizada,percentual_realizado,taxa_aplicada,variedade_semente,data_plantio,tipo_progresso,created_by,updated_by,created_at,updated_at,version';
    const PLAN_COLUMNS = 'id,operation_type,fazenda_scope,gleba_scope,ano,cultura,produto,planned_fields,created_by,updated_by,created_at,updated_at,version';
    const PAGE_SIZE = 500;

    class OperationRepositoryError extends Error {
        constructor(message, code, cause) {
            super(message);
            this.name = 'OperationRepositoryError';
            this.code = code;
            this.cause = cause;
        }
    }

    function requiredText(value, label) {
        const text = String(value ?? '').trim();
        if (!text) throw new OperationRepositoryError(`Informe ${label}.`, 'VALIDATION');
        return text;
    }

    function operationType(value) {
        if (!['adubacao', 'plantio'].includes(value)) {
            throw new OperationRepositoryError('Escolha adubação ou plantio.', 'VALIDATION');
        }
        return value;
    }

    function checkedNumber(value, label) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
            throw new OperationRepositoryError(`Informe ${label}.`, 'VALIDATION');
        }
        const number = Number(value);
        if (!Number.isFinite(number)) throw new OperationRepositoryError(`${label} deve ser um número válido.`, 'VALIDATION');
        return number;
    }

    function context(input, type) {
        return {
            operation_type: operationType(type),
            ano: requiredText(input.ano, 'a safra'),
            cultura: requiredText(input.cultura, 'a cultura'),
            produto: type === 'plantio' ? 'Plantio' : requiredText(input.produto, 'o produto')
        };
    }

    function recordPayload(record, type) {
        const planting = type === 'plantio';
        const payload = {
            ...context(record, type),
            fazenda: requiredText(record.fazenda, 'a fazenda'),
            campo: requiredText(record.campo, 'o talhão'),
            gleba: String(record.gleba ?? '').trim() || null,
            status: record.status,
            area_total: checkedNumber(record.areaTotal, 'a área total'),
            area_realizada: checkedNumber(record.areaRealizada, 'a área realizada'),
            percentual_realizado: checkedNumber(record.percentualRealizado, 'o percentual realizado'),
            taxa_aplicada: planting || record.taxaAplicada == null || record.taxaAplicada === ''
                ? null : checkedNumber(record.taxaAplicada, 'a taxa aplicada'),
            variedade_semente: planting ? String(record.variedadeSemente ?? '').trim() || null : null,
            data_plantio: planting ? record.dataPlantio || null : null,
            tipo_progresso: record.tipoProgresso || 'percentual'
        };
        // Autor, datas, histórico e versão são definidos pelo banco, nunca pelo formulário.
        return payload;
    }

    function toRecord(row) {
        return {
            id: row.id,
            operationType: row.operation_type,
            fazenda: row.fazenda,
            campo: row.campo,
            gleba: row.gleba || '',
            ano: row.ano,
            cultura: row.cultura,
            produto: row.produto,
            status: row.status,
            areaTotal: Number(row.area_total),
            areaRealizada: Number(row.area_realizada),
            percentualRealizado: Number(row.percentual_realizado),
            taxaAplicada: row.taxa_aplicada == null ? null : Number(row.taxa_aplicada),
            variedadeSemente: row.variedade_semente || '',
            dataPlantio: row.data_plantio || '',
            tipoProgresso: row.tipo_progresso,
            updatedBy: row.updated_by,
            ultimaAlteracao: row.updated_at,
            version: row.version
        };
    }

    function toPlan(row) {
        return {
            id: row.id,
            operationType: row.operation_type,
            fazenda: row.fazenda_scope,
            gleba: row.gleba_scope,
            ano: row.ano,
            cultura: row.cultura,
            produto: row.produto,
            plannedFields: row.planned_fields,
            updatedBy: row.updated_by,
            ultimaAlteracao: row.updated_at,
            version: row.version
        };
    }

    function checkResult(result) {
        if (!result.error) return result.data;
        const error = result.error;
        if (['23505', '40001'].includes(error.code)) {
            throw new OperationRepositoryError('Esse registro já existe. Recarregue os dados antes de editar.', 'CONFLICT', error);
        }
        if (error.code === '42501') {
            throw new OperationRepositoryError('Seu perfil não permite salvar esta alteração.', 'FORBIDDEN', error);
        }
        if (['42P01', 'PGRST205'].includes(error.code)) {
            throw new OperationRepositoryError('A estrutura de operações ainda precisa ser criada no Supabase.', 'SCHEMA_MISSING', error);
        }
        throw new OperationRepositoryError('Não foi possível consultar ou salvar no Supabase. A alteração não foi confirmada.', 'DATABASE', error);
    }

    function createRepository(client) {
        if (!client || typeof client.from !== 'function') {
            throw new OperationRepositoryError('A conexão autenticada com o Supabase está indisponível.', 'CLIENT_MISSING');
        }

        async function listPages(makeQuery) {
            const all = [];
            let offset = 0;
            while (true) {
                // count exact detecta limite do servidor menor que o tamanho solicitado.
                const result = await makeQuery().range(offset, offset + PAGE_SIZE - 1);
                const page = checkResult(result) || [];
                all.push(...page);
                if (typeof result.count !== 'number') {
                    throw new OperationRepositoryError('O banco não confirmou o total de registros da consulta.', 'INCOMPLETE_READ');
                }
                if (all.length >= result.count) return all;
                if (!page.length) {
                    throw new OperationRepositoryError('A consulta ficou incompleta. Recarregue os dados.', 'INCOMPLETE_READ');
                }
                // O offset avança pela quantidade efetiva, sem pular registros se o servidor limita a página.
                offset += page.length;
            }
        }

        async function persist(table, payload, existing, columns) {
            let query;
            if (existing.id) {
                if (!Number.isInteger(existing.version) || existing.version < 1) {
                    throw new OperationRepositoryError('Recarregue o registro antes de salvar.', 'VERSION_MISSING');
                }
                query = client.from(table).update(payload).eq('id', existing.id).eq('version', existing.version);
            } else {
                query = client.from(table).insert(payload);
            }
            const data = checkResult(await query.select(columns).maybeSingle());
            if (!data) {
                throw new OperationRepositoryError('O registro mudou ou você não tem permissão para editá-lo. Recarregue antes de salvar.', 'CONFLICT');
            }
            return data;
        }

        return {
            async listFarmRecords(farm) {
                return (await listPages(() => client.from('operation_records')
                    .select(RECORD_COLUMNS, { count: 'exact' }).eq('fazenda', requiredText(farm, 'a fazenda'))
                    .order('id', { ascending: true }))).map(toRecord);
            },
            async listFarmPlans(farm) {
                return (await listPages(() => client.from('operation_plans')
                    .select(PLAN_COLUMNS, { count: 'exact' }).eq('fazenda_scope', requiredText(farm, 'a fazenda'))
                    .order('id', { ascending: true }))).map(toPlan);
            },
            async listFields(farm) {
                return (await listPages(() => client.from('farm_fields')
                    .select('campo,feature', { count: 'exact' }).eq('farm_code', requiredText(farm, 'a fazenda'))
                    .order('campo', { ascending: true }))).map(row => row.feature);
            },
            async saveRecords(records, type) {
                if (!Array.isArray(records) || !records.length || records.length > 500) {
                    throw new OperationRepositoryError('Selecione de 1 a 500 talhões.', 'VALIDATION');
                }
                const payload = records.map(record => {
                    if (record.id && (!Number.isInteger(record.version) || record.version < 1)) {
                        throw new OperationRepositoryError('Recarregue o registro antes de salvar.', 'VERSION_MISSING');
                    }
                    return { ...recordPayload(record, type), id: record.id || null, version: record.version || null };
                });
                const rows = checkResult(await client.rpc('save_operation_batch', { records: payload }));
                if (!Array.isArray(rows) || rows.length !== records.length) {
                    throw new OperationRepositoryError('O banco não confirmou todos os talhões. Recarregue os dados antes de tentar novamente.', 'INCOMPLETE_WRITE');
                }
                return rows.map(toRecord);
            },
            async listRecords(filters) {
                const filterContext = context(filters, filters.operationType);
                const rows = await listPages(() => {
                    let query = client.from('operation_records').select(RECORD_COLUMNS, { count: 'exact' });
                    for (const [key, value] of Object.entries(filterContext)) query = query.eq(key, value);
                    for (const key of ['fazenda', 'gleba', 'campo', 'status']) {
                        if (filters[key] && filters[key] !== 'ALL') query = query.eq(key, filters[key]);
                    }
                    return query.order('id', { ascending: true });
                });
                return rows.map(toRecord);
            },

            async saveRecord(record, type) {
                return toRecord(await persist('operation_records', recordPayload(record, type), record, RECORD_COLUMNS));
            },

            async getPlan(filters) {
                const filterContext = {
                    ...context(filters, filters.operationType),
                    fazenda_scope: filters.fazenda || 'ALL',
                    gleba_scope: filters.gleba || 'ALL'
                };
                let query = client.from('operation_plans').select(PLAN_COLUMNS);
                for (const [key, value] of Object.entries(filterContext)) query = query.eq(key, value);
                const row = checkResult(await query.maybeSingle());
                // null = sem planejamento personalizado; [] = nenhum talhão planejado.
                return row ? toPlan(row) : null;
            },

            async savePlan(plan) {
                const payload = {
                    ...context(plan, plan.operationType),
                    fazenda_scope: String(plan.fazenda || 'ALL').trim(),
                    gleba_scope: String(plan.gleba || 'ALL').trim(),
                    planned_fields: plan.plannedFields
                };
                if (!Array.isArray(payload.planned_fields)) {
                    throw new OperationRepositoryError('Informe a lista de talhões planejados.', 'VALIDATION');
                }
                return toPlan(await persist('operation_plans', payload, plan, PLAN_COLUMNS));
            },

            async listHistory(recordId, source = 'operation_records') {
                if (!['operation_records', 'operation_plans'].includes(source)) {
                    throw new OperationRepositoryError('Tipo de histórico inválido.', 'VALIDATION');
                }
                requiredText(recordId, 'o identificador do registro');
                return listPages(() => client.from('operation_history')
                    .select('id,source_table,record_id,action,actor_id,actor_name,changed_at,previous_data,current_data', { count: 'exact' })
                    .eq('record_id', recordId).eq('source_table', source)
                    .order('id', { ascending: true }));
            }
        };
    }

    root.GeoOperations = Object.freeze({ createRepository, OperationRepositoryError });
})(typeof window !== 'undefined' ? window : globalThis);
