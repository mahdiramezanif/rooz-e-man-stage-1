const fs = require('fs');
const vm = require('vm');
const path = require('path').join(__dirname,'..','app.js');
const source = fs.readFileSync(path,'utf8').replace(/\nmain\(\);\s*$/,'');
const ctx = {
 console, Date, Intl, Math, Number, String, Set, Array, RegExp, globalThis: {}, window: {},
 document: {getElementById: () => ({}), querySelectorAll: () => []},
 clearTimeout(){},setTimeout(){},setInterval(){},
};
vm.createContext(ctx);
vm.runInContext(source,ctx);
const assert = (cond,msg) => {if(!cond) throw new Error(msg)};
const test=(exp)=>vm.runInContext(exp,ctx);
assert(test("getPersianYmd(new Date(2026,9,25)).year")===1405,'current persian year');
assert(test("getPersianYmd(new Date(2026,9,25)).month")===8,'current persian month');
assert(test("getPersianYmd(new Date(2026,9,25)).day")===3,'current persian day');
assert(test("isoDay(persianDateToGregorian(1405,8,3))") === '2026-10-25','Persian round trip');
assert(test("persianDateToGregorian(1404,12,30)") === null,'Nonleap Esfand day 30');
assert(test("isoDay(persianDateToGregorian(1403,12,30))") === '2025-03-20','Leap Esfand day 30');
assert(test("persianDateToGregorian(1405,12,31)") === null,'Esfand 31 invalid');
assert(test("faDigits('21:39')") === '۲۱:۳۹','fa digits string');
assert(test("isValidTime('23:59')") && !test("isValidTime('24:00')"),'time validation');
assert(test("getReminderState({date:'2020-01-01',time:'01:00',done:false},new Date('2026-10-25T10:00:00'))") === 'overdue','overdue');
assert(test("getReminderState({date:'2030-01-01',time:'12:00',done:false},new Date('2026-10-25T10:00:00'))") === 'upcoming','future');
assert(test("getReminderState({date:'2030-01-01',time:'12:00',done:true},new Date('2026-10-25T10:00:00'))") === 'done','completed');
assert(test("validateBackup({app:'rooz-e-man',version:1,tasks:[]}).reminders === null"),'old backup imported without removing reminders');
assert(test("validateBackup({app:'rooz-e-man',version:2,tasks:[],reminders:[{id:'x',title:'تمرین',date:'2026-10-25',time:'12:25',notes:'',done:false}]}).reminders.length===1"),'new backup');
assert(test("(()=>{try {validateBackup({app:'rooz-e-man',version:2,tasks:[],reminders:[{id:'x',title:'x',date:'2026-02-30',time:'12:00'}]});return false} catch(e){return true}})()"),'bad backup validation');
assert(test("validateBackup({app:'rooz-e-man',version:3,tasks:[],reminders:[{id:'x',title:'آب خوردن',date:'2026-10-25',time:'12:25',notifyRepeat:'weekly'}]}).reminders[0].notifyRepeat") === 'weekly','v3 repeat survives backup');
assert(test("isoDay(nextOccurrenceLocal({date:'2025-03-20',time:'12:00',repeat:'yearly'},new Date('2026-03-20T13:00:00')))") === '2027-03-20','yearly Persian next-year followup');
assert(test("isoDay(nextOccurrenceLocal({date:'2025-03-20',time:'12:00',repeat:'monthly'},new Date('2025-04-10T12:00:00')))") === '2025-04-19','month shamsi');
assert(test("isoDay(nextOccurrenceLocal({date:'2025-03-21',time:'12:00',repeat:'monthly'},new Date('2025-04-01T00:00:00')))") === '2025-04-21','monthly day 1');
assert(test("nextOccurrenceLocal({date:'2025-03-20',time:'12:00',repeat:'none'},new Date('2026-01-01T00:00:00'))===null"),'past no-repeat alarm');
assert(test("(()=>{ const v = nextOccurrenceLocal({date:'2025-03-20',time:'12:00',repeat:'yearly'},new Date('2026-03-01T00:00:00')); return getPersianYmd(v).month===12 && getPersianYmd(v).day===29;})()"),'leap day clamped');
console.log('Passed: stage-2 compatibility and stage-3 recurrence/backup checks');
