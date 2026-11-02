(function(root){
    'use strict';
    const O=root.SprayOperations,S=root.SpraySchedule;
    const allowed=new Set(['planned','actual','product','dose','doseUnit','area','responsible','notes']);
    function create(){
        const drafts=new Map(),baselines=new Map();
        function edit(row,field,schedule,column,value){
            if(!allowed.has(column)||row.deleted)return;
            let draft=drafts.get(row.key);
            if(!draft){
                if(row.plantingId&&!baselines.has(row.plantingId))baselines.set(row.plantingId,{plantingId:row.plantingId,actuals:{...schedule?.actuals},fourth:!!schedule?.fourth,version:schedule?.version??null,plantingDate:field.plantingDate});
                draft={original:{...row,scheduleVersion:row.plantingId?baselines.get(row.plantingId).version:null},field:{...field},patch:{}};
                drafts.set(row.key,draft);
            }
            if(column==='planned'){
                draft.patch.autoDate=!!row.plantingId&&!value;
                draft.patch.planned=value|| (row.plantingId?draft.original.planned:'');
            }else draft.patch[column]=value;
        }
        function rows(){return [...drafts.values()].map(draft=>({...draft.original,...draft.patch}));}
        function project(schedules,saved){
            const dates=new Map(schedules.map(row=>[row.plantingId,{...row,actuals:{...row.actuals}}]));
            const metadata=new Map(saved.map(row=>[O.rowKey(row),{...row}]));
            for(const row of rows()){
                if(row.plantingId){
                    if(!dates.has(row.plantingId))dates.set(row.plantingId,{plantingId:row.plantingId,actuals:{},fourth:false});
                    const schedule=dates.get(row.plantingId);schedule.actuals[row.stage]=row.actual||'';
                    if(row.stage==='fung4')schedule.fourth=true;
                }
                metadata.set(O.rowKey(row),{...row,planned:row.plantingId&&row.autoDate?null:row.planned});
            }
            return {schedules:[...dates.values()],saved:[...metadata.values()]};
        }
        function validate(){
            const dates=new Map([...baselines].map(([key,value])=>[key,{...value,actuals:{...value.actuals}}]));
            for(const [key,draft]of drafts){
                const row={...draft.original,...draft.patch};
                try{O.validate(row,draft.field);}catch(failure){throw Error(`${row.farm} / ${row.field} · ${row.name}: ${failure.message}`);}
                if(row.plantingId){const schedule=dates.get(row.plantingId);schedule.actuals[row.stage]=row.actual||'';schedule.fourth=schedule.fourth||row.stage==='fung4';}
            }
            for(const [id,schedule]of dates){
                const row=rows().find(item=>item.plantingId===id);
                try{S.validate(schedule.plantingDate,schedule.actuals,schedule.fourth);}catch(failure){throw Error(`${row.farm} / ${row.field}: ${failure.message}`);}
            }
            return rows();
        }
        return Object.freeze({edit,rows,project,validate,fields:()=>[...drafts.values()].map(draft=>({...draft.field})),has:key=>drafts.has(key),get size(){return drafts.size;},clear(){drafts.clear();baselines.clear();}});
    }
    root.SprayGrid=Object.freeze({create});
    if(typeof module!=='undefined')module.exports=root.SprayGrid;
})(typeof window!=='undefined'?window:globalThis);
