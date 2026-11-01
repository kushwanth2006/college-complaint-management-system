const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, '..', 'paper-latex', 'images');
fs.mkdirSync(out, { recursive: true });
const W = 1600, H = 900;
const C = { ink:'#1d2643', navy:'#202944', muted:'#64708a', line:'#cbd3df', bg:'#f7f8fb', white:'#ffffff', blue:'#2f6fed', teal:'#138a79', gold:'#c18424', red:'#c64b3b', paleBlue:'#eaf0ff', paleTeal:'#e7f5f1', paleGold:'#fbf2df', paleRed:'#fff0ed', grey:'#f1f3f7' };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const text = (x,y,s,size=25,weight=500,color=C.ink,anchor='middle') => `<text x="${x}" y="${y}" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`;
const multi = (x,y,lines,size=22,weight=500,color=C.ink,line=1.35,anchor='middle') => lines.map((s,i)=>text(x,y+i*size*line,s,size,weight,color,anchor)).join('');
const rect = (x,y,w,h,fill=C.white,stroke=C.line,r=18,sw=2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const line = (x1,y1,x2,y2,color=C.muted,width=3,dash='',end=true) => `<path d="M${x1} ${y1} L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" ${dash?`stroke-dasharray="${dash}"`:''} ${end?'marker-end="url(#arrow)"':''}/>`;
const arrow = (x1,y1,x2,y2,label,color=C.blue,dy=-14) => `${line(x1,y1,x2,y2,color,3,'',true)}${label?text((x1+x2)/2,(y1+y2)/2+dy,label,18,650,color):''}`;
const base = (title,sub) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#16213a" flood-opacity=".10"/></filter></defs><rect width="100%" height="100%" fill="${C.bg}"/><rect x="0" y="0" width="14" height="100%" fill="${C.blue}"/>${text(70,72,title,34,750,C.ink,'start')}${text(70,112,sub,19,450,C.muted,'start')}<line x1="70" y1="140" x2="1530" y2="140" stroke="${C.line}" stroke-width="2"/>`;
const end = `<line x1="70" y1="842" x2="1530" y2="842" stroke="${C.line}" stroke-width="2"/>${text(70,878,'CampusDesk · AI - Based College Complaint Management System',15,500,C.muted,'start')}${text(1530,878,'PROJECT DESIGN',14,700,C.muted,'end')}</svg>`;
function save(name, body){fs.writeFileSync(path.join(out,name),base(body.title,body.sub)+body.content+end,'utf8');}
function card(x,y,w,h,title,lines,fill=C.white,accent=C.blue){return `${rect(x,y,w,h,fill,C.line,18,2)}<rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${accent}"/>${text(x+24,y+38,title,23,750,C.ink,'start')}${multi(x+24,y+77,lines,18,500,C.muted,1.45,'start')}`;}

// Figure 4.2: student report through server-side screening, analysis, storage and staff work.
{
 let c='';
 c+=card(80,355,190,150,'Student portal',['Title · details','category · location'],C.white,C.blue);
 c+=card(335,300,230,250,'Relevance screen',['Rule-based campus check','Block personal advice','Prompt for context if unclear'],C.paleGold,C.gold);
 c+=card(635,270,260,310,'Complaint analysis',['Category suggestion','Priority suggestion','Safety override','Duplicate candidates'],C.paleBlue,C.blue);
 c+=card(965,315,235,220,'Incident matching',['Department · location','open status · 10-minute','window · report history'],C.paleTeal,C.teal);
 c+=card(1270,355,245,150,'MongoDB',['Complaint + history','incident links'],C.white,C.navy);
 c+=arrow(270,430,335,430,'submit'); c+=arrow(565,430,635,430,'allowed'); c+=arrow(895,430,965,430,'analyzed'); c+=arrow(1200,430,1270,430,'persist');
 c+=card(965,650,235,115,'Department staff',['review · update status'],C.white,C.teal);
 c+=line(1385,505,1385,705,C.navy,3,'',true); c+=line(1385,705,1200,705,C.navy,3,'',true); c+=text(1290,680,'routed queue',17,650,C.navy);
 c+=card(345,650,300,115,'Relevance outcome',['Rejected or clarification requested'],C.paleRed,C.red);
 c+=line(450,550,450,650,C.red,3,'',true); c+=text(470,615,'not saved as complaint',17,650,C.red,'start');
 c+=text(80,810,'Student keeps an individual complaint record; staff controls subsequent status and priority changes.',17,500,C.muted,'start');
 save('figure-4-2-data-flow.svg',{title:'Figure 4.2 · Complaint data flow',sub:'From student submission to department handling, including the server-side relevance gate.',content:c});
}

// Figure 4.3: use cases, actors and scoped capabilities.
{
 let c=rect(330,190,980,570,'#fbfcfe',C.navy,20,3)+text(820,226,'CampusDesk',25,750,C.navy);
 const actor=(x,y,name,sub)=>`<circle cx="${x}" cy="${y}" r="23" fill="${C.white}" stroke="${C.navy}" stroke-width="4"/><path d="M${x} ${y+24}v70 M${x-35} ${y+53}h70 M${x} ${y+94}l-30 45 M${x} ${y+94}l30 45" fill="none" stroke="${C.navy}" stroke-width="4" stroke-linecap="round"/>${text(x,y+180,name,23,750,C.ink)}${text(x,y+207,sub,16,500,C.muted)}`;
 c+=actor(155,340,'Student','own account'); c+=actor(1450,340,'Department staff','assigned department'); c+=actor(1450,630,'Super administrator','system-wide controls');
 const use=(x,y,w,label,fill=C.white,stroke=C.blue)=>`<ellipse cx="${x}" cy="${y}" rx="${w/2}" ry="43" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>${text(x,y+8,label,18,650,C.ink)}`;
 c+=use(560,320,350,'Register / sign in'); c+=use(980,320,430,'Submit campus complaint');
 c+=use(560,455,380,'Track own complaint status'); c+=use(980,455,400,'View deleted reports');
 c+=use(560,590,390,'Review department queue',C.paleTeal,C.teal); c+=use(980,590,410,'Update status / add note',C.paleTeal,C.teal);
 c+=use(560,700,410,'Approve staff / assign department',C.paleGold,C.gold); c+=use(1000,700,420,'View system complaints / export',C.paleGold,C.gold);
 // actor association lines
 [[178,380,385,320],[178,390,765,320],[178,405,370,455],[178,410,790,455],
  [1424,385,735,590],[1424,400,780,590],[1424,415,1180,455],
  [1424,650,765,700],[1424,665,1210,700]].forEach(a=>c+=line(...a,C.muted,2,'5 7',false));
 c+=text(820,800,'Solid boundary = application scope · associations show which role initiates each use case',16,500,C.muted);
 save('figure-4-3-use-case.svg',{title:'Figure 4.3 · CampusDesk use cases',sub:'Student, department staff, and super administrator actions within the application boundary.',content:c});
}

// Figure 4.4: actual MongoDB document collections and key relationships.
{
 let c='';
 const entity=(x,y,w,h,name,fields,accent)=>{let s=rect(x,y,w,h,C.white,C.line,15,2)+`<path d="M${x+15} ${y}h${w-30}a15 15 0 0 1 15 15v37H${x}V${y+15}a15 15 0 0 1 15-15Z" fill="${accent}"/>`+text(x+w/2,y+34,name,20,750,C.white);fields.forEach((f,i)=>s+=text(x+18,y+78+i*29,f,16,f.startsWith('PK')?700:500,f.startsWith('PK')?C.navy:C.muted,'start'));return s;};
 c+=entity(80,230,300,280,'users',['PK id','college_id · email','password_hash','name · residence · hostel'],C.blue);
 c+=entity(440,210,480,450,'complaints',['PK id · complaint_code','FK user_id → users.id','category · title · description','location · officer · stage_index','ai_category · ai_priority','ai_reviewed · sla_deadline','incident_code · incident_seed_id','deleted_at · created_at'],C.teal);
 c+=entity(1050,200,430,220,'admins',['PK id','college_id · email','password_hash · department','status · approved_by'],C.gold);
 c+=entity(440,700,390,120,'complaint_history',['PK id · FK complaint_id → complaints.id','status change · updated_by · remarks'],C.navy);
 c+=entity(850,700,270,120,'feedback',['PK/FK complaint_id','rating · comment'],C.red);
 c+=entity(80,650,320,170,'password_resets',['FK user_id','otp_hash · expiry · attempts'],C.navy);
 c+=entity(1120,465,350,90,'sessions',['sid · session payload'],C.navy);
 c+=entity(1200,590,300,135,'counters',['_id · seq','complaint / incident IDs'],C.navy);
 c+=line(380,390,440,390,C.blue,3,'',false)+text(410,375,'1 : N',15,700,C.blue);
 c+=line(640,660,640,700,C.navy,3,'',false)+text(660,687,'1 : N',14,700,C.navy,'start');
 c+=line(820,660,900,700,C.red,3,'',false)+text(860,676,'1 : 0..1',14,700,C.red);
 c+=line(230,510,230,650,C.navy,3,'7 6',false)+text(248,590,'1 : N',15,700,C.navy,'start');
 save('figure-4-4-data-model.svg',{title:'Figure 4.4 · CampusDesk application data model',sub:'MongoDB collections, key identifiers, and the main complaint and user relationships.',content:c});
}

// Figure 4.5: request sequence. Analysis and persistence are intentionally separated.
{
 let c=''; const xs=[145,400,690,980,1270,1490], names=['Student','Student portal','Express server','Analysis + rules','MongoDB','Staff portal'];
 xs.forEach((x,i)=>{c+=rect(x-75,178,150,66,i===0||i===5?C.paleBlue:C.white,C.line,12,2)+text(x,218,names[i],17,700,C.ink);c+=`<line x1="${x}" y1="244" x2="${x}" y2="790" stroke="${C.line}" stroke-width="2" stroke-dasharray="7 7"/>`;});
 const msg=(a,b,y,label,color=C.blue,ret=false)=>`${line(xs[a],y,xs[b],y,color,3,ret?'8 7':'',true)}${text((xs[a]+xs[b])/2,y-12,label,17,650,color)}`;
 c+=msg(0,1,290,'enter complaint details'); c+=msg(1,2,340,'POST /api/complaints'); c+=msg(2,2,390,'validate fields + session',C.navy,true);
 c+=msg(2,3,440,'screen campus relevance'); c+=msg(3,2,490,'allowed / reject / clarify',C.gold,true);
 c+=msg(2,3,540,'category + priority + duplicate checks'); c+=msg(3,2,590,'analysis suggestions',C.teal,true);
 c+=msg(2,4,640,'insert complaint + status history'); c+=msg(4,2,690,'saved record + incident fields',C.navy,true);
 c+=msg(2,1,740,'return receipt + triage summary',C.blue,true); c+=msg(5,2,785,'request department queue');
 c+=text(800,825,'A staff update is a later authenticated request that changes status/history within the staff member’s department.',17,550,C.muted);
 save('figure-4-5-sequence.svg',{title:'Figure 4.5 · Complaint submission sequence',sub:'Submission, server-side screening, analysis, database write, response, and department review.',content:c});
}

// Figure 4.6: collaboration among requested runtime objects.
{
 let c='';
 c+=card(110,285,285,250,'Student portal',['Collects report fields','Sends authenticated API','Shows status and history'],C.paleBlue,C.blue);
 c+=card(515,250,490,320,'Express server',['Role/session checks','Relevance screening','Category + priority analysis','Routes by selected category','Enforces staff department scope'],C.white,C.teal);
 c+=card(1125,285,330,250,'MongoDB',['users · admins','complaints · history','sessions · counters'],C.paleGold,C.gold);
 c+=card(515,650,490,135,'Staff portal',['Loads assigned department queue','Submits status and note updates'],C.paleTeal,C.navy);
 c+=arrow(395,355,515,355,'HTTPS / JSON request',C.blue);c+=arrow(515,470,395,470,'complaint result / status',C.teal);
 c+=arrow(1005,350,1125,350,'read / write',C.gold);c+=arrow(1125,465,1005,465,'records / history',C.gold);
 c+=line(760,570,760,650,C.navy,3,'',true);c+=text(815,620,'department-scoped review',18,650,C.navy,'start');
 c+=line(1005,720,1200,535,C.navy,3,'',true);c+=text(1160,650,'API update',17,650,C.navy);
 c+=text(800,825,'The Express server owns authorization and workflow decisions; MongoDB stores the durable complaint records.',18,550,C.muted);
 save('figure-4-6-collaboration.svg',{title:'Figure 4.6 · CampusDesk collaboration diagram',sub:'Student portal, Express server, MongoDB, and department staff portal exchange.',content:c});
}

// Figure 4.7: relevance branch, classification, linking, and human review.
{
 let c='';
 const node=(x,y,w,h,label,lines=[],fill=C.white,accent=C.blue)=>`${rect(x,y,w,h,fill,C.line,16,2)}<rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${accent}"/>${text(x+w/2,y+33,label,20,750,C.ink)}${lines.length?multi(x+w/2,y+66,lines,16,500,C.muted,1.35):''}`;
 c+=node(70,360,180,100,'Student report',['title + details'],C.paleBlue,C.blue);
 c+=node(305,325,220,170,'Relevance screen',['campus context?','safety exception'],C.paleGold,C.gold);
 c+=node(590,210,220,120,'Reject / clarify',['response to student'],C.paleRed,C.red);
 c+=node(590,435,220,150,'Classify + prioritize',['category model/rules','priority model/rules','critical safety override'],C.paleBlue,C.blue);
 c+=node(875,435,220,150,'Incident match?',['category + location','open + time window'],C.paleTeal,C.teal);
 c+=node(1160,275,225,130,'Create new incident',['if no supported match'],C.white,C.navy);
 c+=node(1160,500,225,130,'Link to open incident',['keep each report'],C.paleTeal,C.teal);
 c+=node(1420,385,150,150,'Persist',['complaint','history'],C.white,C.navy);
 c+=node(1160,700,225,105,'Staff review',['confirm / correct'],C.paleGold,C.gold);
 c+=arrow(250,410,305,410,'submit');
 c+=line(525,370,590,270,C.red,3,'',true);c+=text(546,305,'no / unclear',16,650,C.red);
 c+=line(525,460,590,495,C.teal,3,'',true);c+=text(550,494,'relevant / safety',16,650,C.teal);
 c+=arrow(810,500,875,500,'accepted');
 c+=line(1095,475,1160,340,C.navy,3,'',true);c+=text(1115,392,'no match',16,650,C.navy);
 c+=line(1095,540,1160,555,C.teal,3,'',true);c+=text(1110,565,'match',16,650,C.teal);
 c+=line(1385,340,1420,430,C.navy,3,'',true);c+=line(1385,565,1420,490,C.teal,3,'',true);
 c+=line(1495,535,1380,700,C.gold,3,'',true);c+=text(1470,630,'department route',16,650,C.gold,'end');
 c+=text(800,825,'Automated analysis recommends values; authorized staff retain the ability to review and update them.',16,550,C.muted);
 save('figure-4-7-activity.svg',{title:'Figure 4.7 · Complaint triage activity flow',sub:'Relevance outcome → classification and priority → incident linking → persistence and human review.',content:c});
}

function imgData(file){const ext=path.extname(file).slice(1);const mime=ext==='jpg'?'jpeg':ext;return `data:image/${mime};base64,${fs.readFileSync(path.join(out,file)).toString('base64')}`;}
// Figure 6.1 is generated from the actual npm test run recorded for this report.
{
 const lines=['> campusdesk-backend@1.0.0 test','> node --test test/*.test.js','','✔ classifies and prioritizes a widespread network outage','✔ closed and resolved complaints are not duplicate candidates','✔ similarity recognizes equivalent complaint text','✔ maps SQL-era filters and assignments to MongoDB values','✔ 20 paraphrased AC reports become one critical incident with immediate deadline','✔ one student cannot trigger mass escalation','✔ different location, equipment, department, old or resolved reports stay separate','✔ window is anchored to first report and includes ten-minute boundary','✔ normalizes network synonyms and explicit location case','','ℹ tests 9   ℹ pass 9   ℹ fail 0','ℹ duration_ms 337.1223'];
 let c=rect(100,190,1400,600,'#101827','#26364e',20,2)+`<circle cx="140" cy="220" r="8" fill="#f06d61"/><circle cx="168" cy="220" r="8" fill="#e8b94e"/><circle cx="196" cy="220" r="8" fill="#51b883"/>`+text(240,227,'PowerShell · project test run',16,600,'#bac7d9','start');
 lines.forEach((s,i)=>{const col=s.includes('✔')?'#75d6a4':s.includes('fail 0')?'#75d6a4':s.startsWith('>')?'#8ab5ff':'#e0e7f1'; c+=text(150,282+i*35,s,17,s.includes('ℹ tests')?700:500,col,'start');});
 c+=text(800,828,'Test names and summary reproduced from the successful `npm test` run.',16,500,C.muted);
 save('figure-6-1-test-execution.svg',{title:'Figure 6.1 · CampusDesk test execution evidence',sub:'Node.js test runner output from the project’s automated complaint analysis, incident, and data adapter tests.',content:c});
}

// Figure 8.1 uses the existing landing-page capture as source evidence.
{
 const data=imgData('landing-page.png');
 let c=rect(135,188,1330,610,C.white,C.line,20,2)+`<image href="${data}" x="160" y="215" width="1280" height="540" preserveAspectRatio="xMidYMid meet"/>`;
 c+=text(800,785,'Existing local capture · landing page with complaint tracking preview',16,550,C.muted);
 save('figure-8-1-application-output.svg',{title:'Figure 8.1 · CampusDesk application output',sub:'Landing page and sample complaint tracking preview from the project’s saved interface capture.',content:c});
}

// Figure 8.2 uses the project’s saved role registration and login screenshots.
{
 let c=''; const cards=[['Student registration','student-registration.png'],['Department staff login','staff-login.png'],['Super administrator login','admin-login.png']];
 const xs=[120,585,1050];
 cards.forEach(([label,file],i)=>{const x=xs[i], data=imgData(file);c+=rect(x,180,410,630,C.white,C.line,18,2)+text(x+205,222,label,21,750,C.ink)+`<image href="${data}" x="${x+18}" y="245" width="374" height="520" preserveAspectRatio="xMidYMid meet"/>`;});
 c+=text(800,835,'Role-specific UI captures: student account creation, staff sign-in, and super-administrator sign-in.',16,550,C.muted);
 save('figure-8-2-role-based-workflow-output.svg',{title:'Figure 8.2 · CampusDesk role-based workflow output',sub:'Saved interface captures for student, department staff, and super-administrator entry points.',content:c});
}

console.log(`Generated 9 SVG figures in ${out}`);
