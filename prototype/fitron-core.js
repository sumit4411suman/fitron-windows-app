// Fitron core: constants, date/money helpers, demo seed, derived data, reports.
(function(){
const DAY=864e5,MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],WD=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const pad=n=>String(n).padStart(2,'0');
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const a=String(s).slice(0,10).split('-').map(Number);return new Date(a[0],a[1]-1,a[2])};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
const addMonths=(s,n)=>{const d=parse(s),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return iso(d)};
const diff=(a,b)=>Math.round((parse(a)-parse(b))/DAY);
const fd=s=>{if(!s)return '—';const d=parse(s);return d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear()};
const fds=s=>{if(!s)return '—';const d=parse(s);return d.getDate()+' '+MON[d.getMonth()]};
const fym=k=>MON[+k.slice(5,7)-1]+' '+k.slice(0,4);
const fyms=k=>MON[+k.slice(5,7)-1];
const inr=n=>{n=Math.round(n||0);return(n<0?'−':'')+'₹'+Math.abs(n).toLocaleString('en-IN')};
const num=n=>Math.round(n||0).toLocaleString('en-IN');
const ymOf=s=>String(s).slice(0,7);
const nowT=()=>{const d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes())};
const TODAY=iso(new Date());
const nowTs=()=>TODAY+' '+nowT();
const ftime=t=>{if(!t)return '—';let [h,m]=t.split(':').map(Number);const ap=h>=12?'pm':'am';h=h%12||12;return h+':'+pad(m)+' '+ap};
const fts=ts=>ts?(ts.slice(0,10)===TODAY?'Today':fds(ts))+', '+ftime(ts.slice(11,16)):'—';
const sum=(a,f)=>a.reduce((x,y)=>x+(f?f(y):y),0);
const initials=n=>String(n||'?').split(' ').filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase();
function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const monthsBack=n=>{const out=[],d=parse(TODAY);for(let i=n-1;i>=0;i--)out.push(iso(new Date(d.getFullYear(),d.getMonth()-i,1)).slice(0,7));return out};
const monthEnd=k=>iso(new Date(+k.slice(0,4),+k.slice(5,7),0));
const weekStart=s=>addDays(s,-((parse(s).getDay()+6)%7));
const TG={ACTIVE:0,PAID:0,Read:0,Success:0,Active:0,Won:0,Attended:0,'In stock':0,Booked:0,'EXPIRING SOON':1,Delivered:1,'Trial booked':1,Waitlist:1,Contacted:1,'PARTIALLY PAID':2,'Trial done':2,Paused:2,EXPIRED:3,Failed:3,OVERDUE:3,'No-show':3,'Low stock':3,'High risk':3,'PAYMENT PENDING':4,UNPAID:4,'DUE TODAY':4,'Medium risk':4,New:4};
const TGS=[['var(--color-accent-100)','var(--color-accent-800)','transparent'],['transparent','var(--color-accent-700)','var(--color-accent-500)'],['transparent','var(--color-accent-2-700)','var(--color-accent-2-300)'],['var(--color-accent-2-100)','var(--color-accent-2-800)','transparent'],['transparent','var(--color-accent-2-700)','var(--color-accent-2-400)']];
const tag=l=>{const t=TG[l]!==undefined?TGS[TG[l]]:['var(--color-neutral-200)','var(--color-neutral-800)','transparent'];return{label:l,bg:t[0],fg:t[1],bd:t[2]}};

const NAV=[
 {g:'Front desk',items:[['dashboard','Dashboard','ph-squares-four'],['members','Members','ph-users-three'],['leads','Leads & trials','ph-funnel'],['renewals','Renewals','ph-arrows-clockwise'],['attendance','Attendance','ph-calendar-check'],['classes','Classes','ph-calendar-dots']]},
 {g:'Billing',items:[['invoices','Invoices','ph-receipt'],['payments','Payments','ph-hand-coins'],['autopay','UPI autopay','ph-repeat'],['receivables','Receivables','ph-clock-countdown'],['pos','POS & inventory','ph-storefront']]},
 {g:'Accounts',items:[['expenses','Expenses','ph-wallet'],['accounting','Accounting','ph-scales'],['reports','Reports','ph-chart-bar']]},
 {g:'Engage',items:[['ai','Fitron AI','ph-sparkle'],['whatsapp','WhatsApp','ph-whatsapp-logo'],['programs','Workouts & diet','ph-barbell'],['notifications','Notifications','ph-bell']]},
 {g:'Admin',items:[['plans','Plans & offers','ph-tag'],['biometric','Biometric & doors','ph-fingerprint'],['staff','Staff & roles','ph-identification-badge'],['audit','Audit log','ph-list-magnifying-glass'],['settings','Settings','ph-gear-six']]}];
const ALLV=NAV.flatMap(g=>g.items.map(i=>i[0]));
const ROLES={
 'Super Admin':{user:'Sumit Kumar',views:ALLV,act:['addMember','editMember','collect','invoice','renew','expense','void','plans','unlock','lock','whatsapp','docs','settings','import','leads','classes','pos','programs','autopay','ai']},
 'Admin':{user:'Ritika Sinha',views:ALLV.filter(v=>!['staff','audit','settings'].includes(v)),act:['addMember','editMember','collect','invoice','renew','expense','void','plans','lock','whatsapp','docs','leads','classes','pos','programs','autopay','ai']},
 'Accountant':{user:'Anand Verma',views:['dashboard','invoices','payments','autopay','receivables','pos','expenses','accounting','reports','ai','notifications'],act:['collect','invoice','expense','void','lock','autopay','ai']},
 'Receptionist':{user:'Pooja Kumari',views:['dashboard','members','leads','renewals','attendance','biometric','classes','invoices','payments','pos','ai','whatsapp','notifications'],act:['addMember','editMember','collect','invoice','renew','whatsapp','docs','leads','classes','pos','ai']},
 'Trainer':{user:'Vikram Singh',views:['dashboard','members','attendance','classes','programs','notifications'],act:['classes','programs']}};
const STAFF=[
 {id:'U1',name:'Sumit Kumar',role:'Super Admin',branch:'All branches',phone:'7319742490',email:'sumit@powerhausgym.in',last:'Today',shift:'—',ptRate:0},
 {id:'U2',name:'Ritika Sinha',role:'Admin',branch:'City Centre',phone:'9431205567',email:'ritika@powerhausgym.in',last:'Today',shift:'Full day',ptRate:0},
 {id:'U3',name:'Anand Verma',role:'Accountant',branch:'All branches',phone:'9835012278',email:'accounts@powerhausgym.in',last:'Yesterday',shift:'Day',ptRate:0},
 {id:'U4',name:'Pooja Kumari',role:'Receptionist',branch:'City Centre',phone:'7004418823',email:'frontdesk@powerhausgym.in',last:'Today',shift:'Morning',ptRate:0},
 {id:'U5',name:'Vikram Singh',role:'Trainer',branch:'City Centre',phone:'8210345561',email:'vikram@powerhausgym.in',last:'Today',shift:'Morning',ptRate:40},
 {id:'U6',name:'Raju Mahto',role:'Trainer',branch:'City Centre',phone:'9006231145',email:'raju@powerhausgym.in',last:'2 days ago',shift:'Evening',ptRate:35},
 {id:'U7',name:'Neha Das',role:'Receptionist',branch:'Chas',phone:'7250981134',email:'chas@powerhausgym.in',last:'Today',shift:'Evening',ptRate:0},
 {id:'U8',name:'Meera Oraon',role:'Trainer',branch:'Chas',phone:'9102238876',email:'meera@powerhausgym.in',last:'Today',shift:'Morning',ptRate:40}];
const TRAINERS=STAFF.filter(x=>x.role==='Trainer');
const BRANCHES=[{id:'BR-1',name:'City Centre, Bokaro',short:'City Centre'},{id:'BR-2',name:'Chas, Bokaro',short:'Chas'}];
const METHODS=['UPI','Cash','Card','Bank Transfer','Other'];
const DOC_CATS=['Membership Form','ID Proof','Address Proof','Photo','Medical Document','Other'];
const EXP_CATS=['Rent','Electricity','Water','Internet','Staff Salary','Trainer Salary','Equipment Purchase','Equipment Maintenance','Cleaning','Marketing','Advertising','Software','Repairs','Office Expenses','Inventory','Miscellaneous'];
const EXP_GROUP={Rent:'Rent',Electricity:'Utilities',Water:'Utilities',Internet:'Utilities','Staff Salary':'Salaries','Trainer Salary':'Salaries',Marketing:'Marketing',Advertising:'Marketing','Equipment Maintenance':'Maintenance',Repairs:'Maintenance',Cleaning:'Operating','Equipment Purchase':'Equipment',Software:'Operating','Office Expenses':'Operating',Inventory:'Inventory',Miscellaneous:'Other'};
const ASSET_CATS=['Cardio equipment','Strength equipment','Free weights','Electronics & computers','Furniture & fixtures','Air conditioning','Software & licences','Vehicles','Other'];
const DEP_DEFAULT={'Cardio equipment':[15,8],'Strength equipment':[15,10],'Free weights':[15,10],'Electronics & computers':[40,3],'Furniture & fixtures':[10,10],'Air conditioning':[15,8],'Software & licences':[40,3],'Vehicles':[15,8],'Other':[15,5]};
const nextYm=k=>{const y=+k.slice(0,4),m=+k.slice(5,7);return m===12?(y+1)+'-01':y+'-'+pad(m+1)};
const fyOf=k=>{const y=+k.slice(0,4),m=+k.slice(5,7);return m>=4?y:y-1};
function depSchedule(a,upTo){upTo=upTo||ymOf(TODAY);const rows=[];const cost=+a.cost||0,sal=+a.salvage||0;const carried=+a.accDepCarried||0;let nbv=cost-carried,fyBase=cost-carried;let k=a.depFrom||ymOf(a.purchaseDate);const end=a.disposedOn?ymOf(a.disposedOn):upTo;let n=0;
 while(k<=end&&k<=upTo&&n<600){if(k.slice(5,7)==='04')fyBase=nbv;let d=a.method==='SLM'?(cost-sal)/Math.max(1,(+a.life||1)*12):fyBase*(+a.rate||0)/100/12;d=Math.max(0,Math.min(Math.round(d),nbv-sal));nbv-=d;rows.push({ym:k,dep:d,nbv,fy:fyOf(k)});k=nextYm(k);n++}
 return rows}
function assetInfo(a,upTo){const sch=depSchedule(a,upTo);const acc=sum(sch,r=>r.dep)+(+a.accDepCarried||0);const nbv=(+a.cost||0)-acc;const fy=fyOf(upTo||ymOf(TODAY));const fyDep=sum(sch.filter(r=>r.fy===fy),r=>r.dep);const last=sch[sch.length-1];const gain=a.disposedOn?(+a.disposedFor||0)-nbv:0;return {sch,acc,nbv,fyDep,monthDep:last?last.dep:0,gain}}
function depIn(assets,a,b){const ka=ymOf(a),kb=ymOf(b||a);return sum(assets||[],x=>sum(depSchedule(x,kb).filter(r=>r.ym>=ka&&r.ym<=kb),r=>r.dep))}
function disposalsIn(assets,a,b){const L=(assets||[]).filter(x=>x.disposedOn&&x.disposedOn>=a&&x.disposedOn<=b);let gain=0,loss=0;L.forEach(x=>{const g=assetInfo(x).gain;if(g>=0)gain+=g;else loss-=g});return {gain,loss}}
const INC_CATS=['New Membership','Renewal','Personal Training','Registration','Product','Other'];
const LINE_TYPES=['Personal Training','Product','Registration','Other','Additional Charge'];
const LEAD_STAGES=['New','Contacted','Trial booked','Trial done','Won','Lost'];
const SOURCES=['Instagram','Friend','Google','Walk-in','Facebook','Advertisement','Other'];
const TAGS=['Morning','Evening','Weight loss','Muscle gain','Corporate · SAIL','Family','VIP','Student'];
const PLANS=[
 {id:'PL-01',name:'Monthly',months:1,price:1500,regFee:500,discount:0,gst:true,status:'Active',kind:'General',desc:'Full gym floor access, 5:30 am to 10 pm.',features:['Gym floor','Locker','Fitness assessment'],variants:{Female:1300,Student:1200}},
 {id:'PL-02',name:'Quarterly',months:3,price:4000,regFee:500,discount:0,gst:true,status:'Active',kind:'General',desc:'Three months of full access with a diet chart.',features:['Gym floor','Locker','Diet chart'],variants:{Female:3600,Student:3300}},
 {id:'PL-03',name:'Half-Yearly',months:6,price:7500,regFee:500,discount:0,gst:true,status:'Active',kind:'General',desc:'Six months with a monthly body composition check.',features:['Gym floor','Locker','Diet chart','Body composition'],variants:{Female:6800,Student:6200}},
 {id:'PL-04',name:'Annual',months:12,price:13000,regFee:0,discount:0,gst:true,status:'Active',kind:'General',desc:'Best value. Registration fee waived.',features:['Gym floor','Locker','Diet chart','2 PT sessions'],variants:{Female:12000,Student:11000}},
 {id:'PL-05',name:'Personal Training',months:1,price:5000,regFee:0,discount:0,gst:true,status:'Active',kind:'PT',desc:'One-on-one coaching, 12 sessions a month, includes floor access.',features:['12 PT sessions','Custom program','Diet plan'],variants:{}},
 {id:'PL-06',name:'Couple Quarterly',months:3,price:7000,regFee:500,discount:0,gst:true,status:'Active',kind:'Couple',desc:'Two members, one invoice. Price is for both.',features:['2 members','Gym floor','Diet chart'],variants:{}},
 {id:'PL-07',name:'Student Monthly',months:1,price:1200,regFee:300,discount:0,gst:true,status:'Active',kind:'Student',desc:'For school and college students with a valid ID.',features:['Gym floor','Off-peak hours'],variants:{}},
 {id:'PL-09',name:'Family Quarterly',months:3,price:10500,regFee:500,discount:0,gst:true,status:'Active',kind:'Family',desc:'Up to three family members at one address.',features:['3 members','Gym floor','Diet chart'],variants:{}},
 {id:'PL-10',name:'Corporate · SAIL',months:6,price:6500,regFee:0,discount:0,gst:true,status:'Active',kind:'Corporate',desc:'Negotiated rate for SAIL employees with company ID.',features:['Gym floor','Locker','Body composition'],variants:{}},
 {id:'PL-08',name:'Monsoon Offer 2025',months:2,price:2500,regFee:0,discount:0,gst:true,status:'Inactive',kind:'General',desc:'Seasonal offer, July–August 2025.',features:['Gym floor'],variants:{}}];
const TEMPLATES=[
 {key:'welcome',name:'Welcome message',trigger:'New member registers',enabled:true,body:'Hi {{member_name}}, welcome to {{gym_name}}!\n\nYour member ID is {{member_id}}.\nPlan: {{plan_name}}\nValid: {{start_date}} to {{expiry_date}}\n\nSee you on the floor.'},
 {key:'payment',name:'Payment confirmation',trigger:'Payment received',enabled:true,body:'Hi {{member_name}}, we have received ₹{{amount}} against invoice {{invoice_number}}. Balance due: ₹{{pending_amount}}.\n\nThank you,\n{{gym_name}}'},
 {key:'invoice',name:'Invoice PDF',trigger:'Invoice generated',enabled:true,body:'Hi {{member_name}}, your invoice {{invoice_number}} for ₹{{amount}} is attached as a PDF.\n\n{{gym_name}}'},
 {key:'due',name:'Payment reminder',trigger:'Balance pending',enabled:true,body:'Hi {{member_name}}, a balance of ₹{{pending_amount}} is pending on invoice {{invoice_number}}. Please pay at the front desk or by UPI.\n\n{{gym_name}}'},
 {key:'exp7',name:'Expiry reminder · 7 days',trigger:'7 days before expiry',enabled:true,body:'Hi {{member_name}},\n\nYour {{gym_name}} membership is expiring on {{expiry_date}}.\n\nMembership Plan: {{plan_name}}\nRenewal Amount: ₹{{amount}}\n\nPlease contact us or visit the gym to renew your membership.\n\n{{gym_name}}\nC-7, Sector 4, City Centre, Bokaro'},
 {key:'exp3',name:'Expiry reminder · 3 days',trigger:'3 days before expiry',enabled:true,body:'Hi {{member_name}}, your gym membership will expire in 3 days ({{expiry_date}}). Renewal amount: ₹{{amount}}.\n\n{{gym_name}}'},
 {key:'exp1',name:'Expiry reminder · 1 day',trigger:'1 day before expiry',enabled:true,body:'Hi {{member_name}}, your membership expires tomorrow. Renew {{plan_name}} for ₹{{amount}} at the front desk or reply to this message.\n\n{{gym_name}}'},
 {key:'expired',name:'Expiry message',trigger:'On expiry date',enabled:true,body:'Hi {{member_name}}, your {{gym_name}} membership has expired. Renew now to continue your fitness journey.\n\n{{gym_name}}'},
 {key:'renewal',name:'Renewal confirmation',trigger:'After renewal',enabled:true,body:'Hi {{member_name}}, your {{plan_name}} membership is renewed till {{expiry_date}}. Invoice {{invoice_number}} is attached.\n\n{{gym_name}}'},
 {key:'autopay',name:'Autopay debit notice',trigger:'24 h before UPI autopay debit',enabled:true,body:'Hi {{member_name}}, ₹{{amount}} will be debited tomorrow via UPI autopay for your {{plan_name}} membership.\n\n{{gym_name}}'},
 {key:'class',name:'Class booking confirmation',trigger:'Class booked',enabled:true,body:'Hi {{member_name}}, your class booking is confirmed. Please arrive 5 minutes early.\n\n{{gym_name}}'},
 {key:'winback',name:'Win-back offer',trigger:'Fitron AI · member at risk',enabled:false,body:'Hi {{member_name}}, we have missed you at {{gym_name}}! Come back this week and your next session with a trainer is on us.'},
 {key:'birthday',name:'Birthday wishes',trigger:'On birthday',enabled:true,body:'Happy birthday, {{member_name}}! Everyone at {{gym_name}} wishes you a strong year ahead.'},
 {key:'campaign',name:'Custom campaign',trigger:'Sent manually',enabled:true,body:'Hi {{member_name}}, '}];
const VARS=['member_name','member_id','plan_name','start_date','expiry_date','amount','pending_amount','invoice_number','gym_name'];
const PRODUCTS=[
 {id:'SKU-01',name:'Whey Protein 2 kg',cat:'Supplements',price:4200,cost:3300,stock:9,reorder:5},
 {id:'SKU-02',name:'Creatine 250 g',cat:'Supplements',price:1150,cost:780,stock:14,reorder:6},
 {id:'SKU-03',name:'BCAA 300 g',cat:'Supplements',price:1450,cost:1020,stock:3,reorder:4},
 {id:'SKU-04',name:'Pre-workout 30 servings',cat:'Supplements',price:1899,cost:1350,stock:6,reorder:4},
 {id:'SKU-05',name:'Power Haus T-shirt',cat:'Apparel',price:799,cost:320,stock:22,reorder:10},
 {id:'SKU-06',name:'Shaker bottle',cat:'Accessories',price:450,cost:160,stock:31,reorder:10},
 {id:'SKU-07',name:'Lifting straps',cat:'Accessories',price:549,cost:210,stock:2,reorder:5},
 {id:'SKU-08',name:'Mineral water 1 L',cat:'Drinks',price:30,cost:14,stock:96,reorder:40},
 {id:'SKU-09',name:'Protein bar',cat:'Drinks',price:120,cost:72,stock:38,reorder:20},
 {id:'SKU-10',name:'Day pass',cat:'Services',price:200,cost:0,stock:null,reorder:null}];
const CLASSES=[
 ['HIIT','U5',0,'06:30',45,15],['Strength basics','U6',0,'18:30',60,12],['Yoga','U8',1,'07:00',60,20],['Zumba','U8',1,'18:00',45,25],
 ['HIIT','U5',2,'06:30',45,15],['Functional','U6',2,'19:00',50,14],['Core & mobility','U8',3,'07:00',40,18],['Boxing fit','U5',3,'18:30',45,12],
 ['HIIT','U5',4,'06:30',45,15],['Zumba','U8',4,'18:00',45,25],['Strength basics','U6',5,'08:00',60,12],['Yoga','U8',5,'07:00',60,20],['Spin','U6',6,'08:00',45,10]];
const WORKOUTS=[
 {id:'WK-1',name:'Beginner full body',goal:'General fitness',level:'Beginner',weeks:4,days:[{d:'Day A',ex:[['Treadmill warm-up','8 min'],['Goblet squat','3 × 12'],['Lat pulldown','3 × 12'],['Dumbbell bench press','3 × 10'],['Plank','3 × 30 s']]},{d:'Day B',ex:[['Cycle warm-up','8 min'],['Leg press','3 × 12'],['Seated row','3 × 12'],['Shoulder press','3 × 10'],['Dead bug','3 × 10']]}]},
 {id:'WK-2',name:'Push · Pull · Legs',goal:'Muscle gain',level:'Intermediate',weeks:8,days:[{d:'Push',ex:[['Bench press','4 × 8'],['Incline dumbbell press','3 × 10'],['Cable fly','3 × 12'],['Tricep pushdown','4 × 12']]},{d:'Pull',ex:[['Deadlift','4 × 5'],['Pull-ups','4 × 8'],['Barbell row','3 × 10'],['Biceps curl','3 × 12']]},{d:'Legs',ex:[['Back squat','4 × 6'],['Romanian deadlift','3 × 10'],['Walking lunge','3 × 12'],['Calf raise','4 × 15']]}]},
 {id:'WK-3',name:'Fat loss circuit',goal:'Weight loss',level:'Beginner',weeks:6,days:[{d:'Circuit 1',ex:[['Rowing','5 min'],['Kettlebell swing','4 × 15'],['Box step-up','4 × 12'],['Battle ropes','4 × 30 s'],['Incline walk','15 min']]},{d:'Circuit 2',ex:[['Skipping','5 min'],['Thrusters','4 × 12'],['Mountain climbers','4 × 30 s'],['TRX row','4 × 12'],['Cycle intervals','12 min']]}]},
 {id:'WK-4',name:'Strength 5×5',goal:'Strength',level:'Advanced',weeks:12,days:[{d:'Workout A',ex:[['Squat','5 × 5'],['Bench press','5 × 5'],['Barbell row','5 × 5']]},{d:'Workout B',ex:[['Squat','5 × 5'],['Overhead press','5 × 5'],['Deadlift','1 × 5']]}]}];
const DIETS=[
 {id:'DT-1',name:'Vegetarian fat loss · 1,600 kcal',kcal:1600,protein:95,meals:[['Breakfast','Besan chilla (2) with mint chutney, black coffee'],['Mid-morning','1 apple, 10 almonds'],['Lunch','2 multigrain rotis, dal, sabzi, salad, curd'],['Evening','Roasted chana, green tea'],['Dinner','Paneer bhurji (100 g), 1 roti, sautéed vegetables']]},
 {id:'DT-2',name:'High-protein gain · 2,800 kcal',kcal:2800,protein:160,meals:[['Breakfast','4 egg omelette, 3 slices brown bread, banana shake'],['Mid-morning','Whey shake, peanut butter toast'],['Lunch','Rice, chicken curry (200 g), dal, salad'],['Evening','Sprouts chaat, 2 boiled eggs'],['Dinner','3 rotis, fish or paneer (200 g), vegetables, curd']]},
 {id:'DT-3',name:'Balanced maintenance · 2,100 kcal',kcal:2100,protein:110,meals:[['Breakfast','Poha with peanuts, 2 boiled eggs or tofu'],['Mid-morning','Fruit bowl'],['Lunch','Rice, rajma, salad, buttermilk'],['Evening','Makhana, tea'],['Dinner','2 rotis, chicken or soya, mixed vegetables']]}];

function seed(){
 const r=rng(20260924),R=()=>r(),pick=a=>a[Math.floor(R()*a.length)],ri=(a,b)=>a+Math.floor(R()*(b-a+1));
 const wpick=w=>{let t=sum(w,x=>x[1]),x=R()*t;for(const [k,v] of w){if((x-=v)<0)return k}return w[0][0]};
 const T=TODAY,plans=JSON.parse(JSON.stringify(PLANS)),P=id=>plans.find(p=>p.id===id);
 const fm=['Rahul','Amit','Vikash','Rohit','Saurabh','Ankit','Manish','Deepak','Abhishek','Gaurav','Aditya','Karan','Suraj','Nikhil','Ravi','Harsh','Sunny','Prakash','Varun','Ajay','Mohit','Sachin','Arjun','Rajesh','Aman','Kunal','Shubham','Aniket','Ritesh','Pankaj'];
 const ff=['Priya','Sneha','Anjali','Pooja','Neha','Riya','Kajal','Shreya','Nisha','Swati','Tanya','Divya','Megha','Aarti','Komal','Pallavi','Ritu','Muskan','Simran','Isha','Payal','Kriti','Sakshi','Bhavna'];
 const ln=['Kumar','Singh','Sharma','Gupta','Mahto','Verma','Prasad','Jha','Sinha','Mishra','Das','Yadav','Pandey','Roy','Tiwari','Choudhary','Srivastava','Agarwal','Oraon','Mandal','Bose','Sahu','Thakur','Dubey','Soren','Jaiswal','Ojha','Munda','Bhagat','Keshri','Anand','Tudu'];
 const areas=[['Sector 4','827004'],['Sector 1','827001'],['Sector 2','827002'],['Sector 9','827009'],['Sector 12','827012'],['Co-operative Colony','827001'],['Hari Om Nagar','827013']];
 const occ=['Student','Engineer, SAIL','Teacher','Business','Software developer','Doctor','Homemaker','Bank officer','Govt. employee','Accountant','Shop owner','Nurse'];
 const rel=['Father','Mother','Spouse','Brother','Sister','Friend'];
 const planW=[['PL-01',28],['PL-02',22],['PL-03',11],['PL-04',8],['PL-05',9],['PL-06',5],['PL-07',11],['PL-09',3],['PL-10',3]];
 const offs=[-3,-6,-11,-19,-34,-52,-88,-140,-9,0,1,2,3,4,6,7,9,11,13,15];
 const used=new Set(),raw=[];
 for(let i=0;i<72;i++){
  const g=R()<0.62?'Male':'Female';let name;do{name=pick(g==='Male'?fm:ff)+' '+pick(ln)}while(used.has(name));used.add(name);
  let plan=P(wpick(planW));const isNew=i>=20&&i<27;let start,end;
  if(isNew){start=addDays(T,-ri(0,Math.max(0,parse(T).getDate()-1)));end=addDays(addMonths(start,plan.months),-1)}
  else{let off=i<offs.length?offs[i]:(plan.months===1?ri(16,27):ri(16,plan.months*30-4));end=addDays(T,off);start=addMonths(addDays(end,1),-plan.months)}
  const chain=[{plan,start,end}];const prev=isNew?0:ri(0,4);let s=start;
  for(let k=0;k<prev;k++){const pp=R()<0.7?chain[0].plan:P(wpick(planW));const gap=R()<0.2?ri(3,20):0;const e=addDays(s,-1-gap);const st=addMonths(addDays(e,1),-pp.months);if(diff(T,st)>430)break;chain.unshift({plan:pp,start:st,end:e});s=st}
  const br=R()<0.84?'BR-1':'BR-2';const area=br==='BR-2'?['Chas','827013']:pick(areas);
  let dob=iso(new Date(ri(1976,2008),ri(0,11),ri(1,28)));if(i===33||i===48)dob=(ri(1990,2002))+TODAY.slice(4);
  const phone=String(pick([6,7,8,9]))+String(ri(100000000,999999999));
  raw.push({g,name,phone,plan,chain,br,area,dob,i});
 }
 raw.sort((a,b)=>a.chain[0].start<b.chain[0].start?-1:1);
 const members=[],memberships=[],invoices=[],payments=[];let msSeq=0;
 const recv=br=>br==='BR-2'?'Neha Das':wpick([['Pooja Kumari',60],['Sumit Kumar',20],['Ritika Sinha',20]]);
 const txnFor=m=>m==='UPI'?'UPI'+ri(3000,9999)+String(ri(10000000,99999999)):m==='Card'?'CRD-'+ri(100000,999999):m==='Bank Transfer'?'NEFT'+ri(10000000,99999999):'';
 const payM=()=>wpick([['UPI',50],['Cash',30],['Card',12],['Bank Transfer',8]]);
 raw.forEach((x,idx)=>{
  const id='PHG-'+(1001+idx);const [first]=x.name.split(' ');
  const ptTrainer=x.br==='BR-2'?'U8':pick(['U5','U6']);
  const tags=[];if(R()<0.5)tags.push(pick(['Morning','Evening']));if(R()<0.3)tags.push(pick(['Weight loss','Muscle gain']));if(x.plan.kind==='Corporate')tags.push('Corporate · SAIL');if(x.plan.kind==='Family')tags.push('Family');if(x.plan.kind==='Student')tags.push('Student');
  const m={id,name:x.name,gender:x.g,dob:x.dob,phone:x.phone,wa:(x.i===12||x.i===41)?x.phone.slice(0,9):x.phone,email:first.toLowerCase()+'.'+x.name.split(' ')[1].toLowerCase()+ri(1,99)+'@gmail.com',occupation:pick(occ),
   address:{house:(x.br==='BR-2'?'H. No. ':'Qr. ')+ri(1,900)+'/'+pick(['A','B','C','D']),area:x.area[0],city:'Bokaro Steel City',state:'Jharkhand',pin:x.area[1]},
   emergency:{name:pick(R()<0.5?fm:ff)+' '+x.name.split(' ')[1],rel:pick(rel),phone:String(pick([7,8,9]))+String(ri(100000000,999999999))},
   source:wpick([['Instagram',30],['Friend',25],['Google',15],['Walk-in',15],['Facebook',6],['Advertisement',5],['Other',4]]),
   notes:R()<0.2?pick(['Mild lower back pain, avoid heavy deadlifts.','Goal: lose 8 kg before wedding in December.','Knee surgery 2023. Cleared by doctor.','Diabetic, keep a snack handy.']):'',
   staffNotes:R()<0.15?pick(['Prefers morning slot.','Asked about couple plan for spouse.','Pays on the 5th after salary.']):'',
   branch:x.br,joined:x.chain[0].start,trainerId:(x.plan.kind==='PT'||R()<0.2)?ptTrainer:null,tags,workoutId:R()<0.55?pick(WORKOUTS).id:null,dietId:R()<0.4?pick(DIETS).id:null,suspended:x.i===57,createdBy:'Pooja Kumari'};
  members.push(m);
  x.chain.forEach((c,k)=>{
   const msId='MS-'+(++msSeq);const disc=pick([0,0,0,0,100,200,500].filter(d=>d<c.plan.price*0.2));
   let idate=k===0?c.start:addDays(c.start,-ri(0,2));if(idate>T)idate=T;
   const cat=c.plan.kind==='PT'?'Personal Training':(k===0?'New Membership':'Renewal');
   const lines=[{desc:c.plan.name+' membership ('+fd(c.start)+' – '+fd(c.end)+')',qty:1,rate:c.plan.price,disc,tax:0,cat,plan:c.plan.id}];
   if(k===0&&c.plan.regFee){const waive=R()<0.3;lines.push({desc:'Registration fee',qty:1,rate:c.plan.regFee,disc:waive?c.plan.regFee:0,tax:0,cat:'Registration'})}
   const inv={memberId:id,date:idate,due:c.start>idate?c.start:idate,lines,branch:x.br,msId,by:recv(x.br),cancelled:false,trainerId:c.plan.kind==='PT'?m.trainerId:null};
   invoices.push(inv);
   memberships.push({id:msId,memberId:id,planId:c.plan.id,start:c.start,end:c.end,type:k===0?'New':'Renewal',inv,price:c.plan.price,discount:disc,cat:'Standard'});
   const total=sum(lines,l=>l.qty*l.rate-l.disc);const last=k===x.chain.length-1;const u=R();
   let plan=[total];if(last&&u<0.1)plan=[];else if(last&&u<0.25)plan=[Math.round(total*(0.5+R()*0.2)/100)*100];else if(!last&&u<0.03)plan=[Math.round(total*0.6/100)*100];
   if(plan.length===1&&plan[0]===total&&R()<0.12&&total>=3000){const a=Math.round(total*0.6/100)*100;plan=[a,total-a]}
   plan.forEach((amt,j)=>{const meth=payM();const pd=j===0?idate:addDays(idate,ri(4,15));if(pd>T||amt<=0)return;payments.push({inv,memberId:id,date:pd,amount:amt,method:meth,txn:txnFor(meth),by:recv(x.br),notes:j===1?'Balance cleared':'',status:'Success',branch:x.br})});
  });
 });
 // POS sales and PT add-ons
 for(let i=0;i<46;i++){
  const m=pick(members);const d=addDays(T,-ri(0,200));if(d<m.joined)continue;
  const pr=pick(PRODUCTS.filter(p=>p.id!=='SKU-10'));const qty=pr.price<200?ri(1,4):1;
  const inv={memberId:m.id,date:d,due:d,lines:[{desc:pr.name,qty,rate:pr.price,disc:0,tax:0,cat:'Product',sku:pr.id}],branch:m.branch,by:recv(m.branch),cancelled:false,pos:true};
  invoices.push(inv);const meth=wpick([['UPI',60],['Cash',40]]);payments.push({inv,memberId:m.id,date:d,amount:qty*pr.price,method:meth,txn:txnFor(meth),by:inv.by,notes:'POS sale',status:'Success',branch:m.branch});
 }
 invoices.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);invoices.forEach((v,i)=>{v.no='INV-'+(1001+i)});
 memberships.forEach(x=>{x.invoice=x.inv.no;delete x.inv});
 payments.sort((a,b)=>a.date<b.date?-1:1);payments.forEach((p,i)=>{p.id='PAY-'+(5001+i);p.invoice=p.inv.no;p.ts=p.date+' '+pad(ri(7,20))+':'+pad(ri(0,59));delete p.inv});
 // void one old invoice for history
 const vd=invoices.find(v=>v.pos&&diff(T,v.date)>40);if(vd){vd.cancelled=true;vd.voidReason='Wrong product billed; re-issued';vd.voidBy='Ritika Sinha';payments.filter(p=>p.invoice===vd.no).forEach(p=>{p.status='Reversed';p.reverseReason='Invoice cancelled'})}
 // expenses
 const expenses=[];let eSeq=0;const E=(date,category,desc,vendor,amount,method,br)=>{if(date>T)return;expenses.push({id:'EXP-'+(++eSeq+300),date,category,desc,vendor,amount,method,bill:category==='Rent'||category==='Staff Salary'||category==='Trainer Salary'?'':'B'+ri(1000,9999),notes:'',by:'Anand Verma',branch:br,file:R()<0.6?'bill-'+eSeq+'.pdf':''})};
 monthsBack(13).forEach((k,mi)=>{[['BR-1',1],['BR-2',0.45]].forEach(([br,f])=>{
  E(k+'-01','Staff Salary','Front desk and housekeeping salaries','Payroll',Math.round(8000*f/100)*100,'Bank Transfer',br);
  E(k+'-01','Trainer Salary','Trainer salaries','Payroll',Math.round(14000*f/100)*100,'Bank Transfer',br);
  E(k+'-05','Rent','Monthly rent · '+(br==='BR-1'?'C-7, Sector 4':'Main Road, Chas'),br==='BR-1'?'S. K. Properties':'Gupta Estates',br==='BR-1'?14000:7000,'Bank Transfer',br);
  E(k+'-10','Electricity','Electricity bill','JBVNL',Math.round(ri(6200,8900)*f),'UPI',br);
  E(k+'-10','Water','Water supply','Bokaro Steel City Water Supply',br==='BR-1'?600:300,'Cash',br);
  E(k+'-12','Internet','Broadband 200 Mbps','Airtel',999,'UPI',br);
  E(k+'-15','Cleaning','Cleaning supplies','Shree Traders',Math.round(ri(1500,2600)*f),'Cash',br);
  if(br==='BR-1'){E(k+'-18','Marketing','Instagram and Facebook ads','Meta Platforms',ri(15,50)*100,'Card',br);E(k+'-02','Software','Fitron subscription','Fitron',1499,'UPI',br);
   if(R()<0.5)E(k+'-'+pad(ri(3,27)),'Equipment Maintenance',pick(['Treadmill servicing','Cable machine repair','Spin bike service']),'FitCare Services',ri(18,65)*100,'UPI',br);
   if(R()<0.4)E(k+'-'+pad(ri(3,27)),pick(['Office Expenses','Miscellaneous']),pick(['Printer ink and stationery','Drinking water cans','Festival decoration']),'Local vendor',ri(4,25)*100,'Cash',br);
   if(mi%3===0)E(k+'-20','Inventory','Supplement restock','NutriHub Distributors',ri(120,220)*100,'Bank Transfer',br);
   if(mi===4)E(k+'-22','Equipment Purchase','Adjustable dumbbell set and rack','Sportex India',64000,'Bank Transfer',br);
   if(mi===9)E(k+'-14','Repairs','AC compressor repair','Cool Air Services',8500,'Cash',br);
   if(mi===12)E(k+'-08','Advertising','Hoarding at City Centre roundabout','Bokaro Ads',12000,'Bank Transfer',br);}
 })});
 // documents
 const docs=[];let dSeq=0;members.forEach(m=>{if(R()<0.9)docs.push({id:'DOC-'+(++dSeq),memberId:m.id,cat:'Membership Form',name:'Registration form · '+m.id+'.pdf',type:'pdf',size:ri(180,900)+' KB',date:m.joined,by:'Pooja Kumari'});if(R()<0.8)docs.push({id:'DOC-'+(++dSeq),memberId:m.id,cat:'ID Proof',name:'Aadhaar card.jpg',type:'jpg',size:ri(300,1400)+' KB',date:m.joined,by:'Pooja Kumari'});if(R()<0.12)docs.push({id:'DOC-'+(++dSeq),memberId:m.id,cat:'Medical Document',name:'Fitness clearance.pdf',type:'pdf',size:ri(100,400)+' KB',date:m.joined,by:'Vikram Singh'})});
 // whatsapp
 const wa=[];let wSeq=0;const invMap={};invoices.forEach(v=>invMap[v.no]=v);
 const W=(m,key,name,date,text,att)=>{if(date>T)return;const failed=m.wa.length!==10;const st=failed?'Failed':diff(T,date)>=1?wpick([['Read',70],['Delivered',25],['Sent',5]]):wpick([['Read',40],['Delivered',40],['Sent',20]]);wa.push({id:'WA-'+(++wSeq),memberId:m.id,key,name,date,time:pad(ri(7,21))+':'+pad(ri(0,59)),status:st,text,to:m.wa,attachment:att||''})};
 const tplName=k=>TEMPLATES.find(t=>t.key===k).name;
 members.forEach(m=>{W(m,'welcome',tplName('welcome'),m.joined,'Hi '+m.name+', welcome to Power Haus Gym! Your member ID is '+m.id+'.')});
 invoices.forEach(v=>{if(v.pos)return;const m=members.find(x=>x.id===v.memberId);W(m,'invoice',tplName('invoice'),v.date,'Hi '+m.name+', your invoice '+v.no+' is attached as a PDF.',v.no+'.pdf')});
 payments.forEach(p=>{const m=members.find(x=>x.id===p.memberId);W(m,'payment',tplName('payment'),p.date,'Hi '+m.name+', we have received '+inr(p.amount)+' against invoice '+p.invoice+'.')});
 // attendance
 const attendance=[];let aSeq=0;
 const covers=(m,d)=>memberships.some(x=>x.memberId===m.id&&x.start<=d&&x.end>=d);
 const habit={};members.forEach(m=>{habit[m.id]=R()<0.2?0.12:0.3+R()*0.45});
 const nowMin=new Date().getHours()*60+new Date().getMinutes();
 for(let d=34;d>=0;d--){const day=addDays(T,-d);if(parse(day).getDay()===0&&R()<0.6)continue;members.forEach(m=>{if(m.suspended||!covers(m,day))return;let p=habit[m.id];if(d<14&&(m.id.endsWith('3')||m.id.endsWith('7'))&&habit[m.id]<0.2)p=0.02;if(R()>p)return;
  const morning=R()<0.55;const inMin=morning?ri(330,540):ri(990,1260);if(d===0&&inMin>nowMin)return;const dur=ri(55,105);const outMin=inMin+dur;
  attendance.push({id:'AT-'+(++aSeq),memberId:m.id,date:day,in:pad(Math.floor(inMin/60))+':'+pad(inMin%60),out:(d===0&&outMin>nowMin)?null:pad(Math.floor(outMin/60))+':'+pad(outMin%60),method:wpick([['QR',45],['Biometric',30],['Member ID',15],['Manual',10]]),branch:m.branch,type:'Member'})})}
 for(let i=0;i<9;i++){const d=addDays(T,-ri(0,20));attendance.push({id:'AT-'+(++aSeq),memberId:null,guest:pick(fm)+' '+pick(ln),date:d,in:pad(ri(7,19))+':'+pad(ri(0,59)),out:null,method:'Manual',branch:'BR-1',type:pick(['Trial','Guest','Day pass'])})}
 // leads
 const leads=[];const stagesW=[['New',4],['Contacted',5],['Trial booked',4],['Trial done',3],['Won',4],['Lost',2]];
 for(let i=0;i<22;i++){const g=R()<0.6;const st=wpick(stagesW);const c=addDays(T,-ri(0,40));leads.push({id:'LD-'+(201+i),name:pick(g?fm:ff)+' '+pick(ln),phone:String(pick([7,8,9]))+String(ri(100000000,999999999)),source:wpick([['Instagram',35],['Walk-in',25],['Google',15],['Friend',15],['Facebook',10]]),interest:pick(['Monthly','Quarterly','Personal Training','Annual','Couple Quarterly']),stage:st,created:c,followUp:st==='Won'||st==='Lost'?'':addDays(T,ri(-2,5)),trialDate:st==='Trial booked'?addDays(T,ri(0,4)):st==='Trial done'?addDays(T,-ri(1,6)):'',owner:pick(['Pooja Kumari','Ritika Sinha']),notes:pick(['Asked for student discount.','Works shifts at SAIL, wants evening slot.','Coming with a friend.','Price-sensitive, compare with nearby gym.','Wants PT for weight loss.','']),branch:R()<0.85?'BR-1':'BR-2',lostReason:st==='Lost'?pick(['Too far from home','Chose another gym','Price']):''})}
 // classes & bookings
 const classes=CLASSES.map((c,i)=>({id:'CL-'+(i+1),name:c[0],trainerId:c[1],day:c[2],time:c[3],dur:c[4],cap:c[5],branch:c[1]==='U8'?'BR-2':'BR-1',room:c[0]==='Spin'?'Spin studio':'Studio'}));
 const bookings=[];let bSeq=0;const ws=weekStart(T);
 [-7,0].forEach(off=>classes.forEach(c=>{const date=addDays(ws,off+c.day);const pool=members.filter(m=>m.branch===c.branch&&!m.suspended);const n=Math.min(pool.length,Math.round(c.cap*(0.55+R()*0.5)));const chosen=[...pool].sort(()=>R()-0.5).slice(0,n+(R()<0.3?2:0));chosen.forEach((m,j)=>{const past=date<T;const status=j>=c.cap?'Waitlist':past?(R()<0.86?'Attended':'No-show'):'Booked';bookings.push({id:'BK-'+(++bSeq),classId:c.id,date,memberId:m.id,status})})}));
 // progress & PRs
 const progress=[];members.forEach(m=>{if(!m.workoutId||R()<0.3)return;let w=m.gender==='Male'?ri(64,96):ri(52,82);let bf=m.gender==='Male'?ri(18,30):ri(24,36);const n=ri(3,6);for(let k=n;k>=0;k--){progress.push({memberId:m.id,date:addDays(T,-k*14-ri(0,4)),weight:+(w).toFixed(1),bodyFat:+bf.toFixed(1),waist:Math.round(w*0.95),notes:''});w-=R()*1.2-0.3;bf-=R()*0.8}});
 const prs=[];members.forEach(m=>{if(!m.workoutId||R()<0.5)return;[['Bench press',m.gender==='Male'?ri(40,90):ri(20,45)],['Back squat',m.gender==='Male'?ri(60,130):ri(35,70)],['Deadlift',m.gender==='Male'?ri(80,160):ri(45,90)]].forEach(([l,v])=>prs.push({memberId:m.id,lift:l,value:v,date:addDays(T,-ri(3,60))}))});
 // autopay mandates
 const mandates=[];let mSeq=0;members.forEach(m=>{const ms=memberships.filter(x=>x.memberId===m.id);const cur=ms[ms.length-1];const p=P(cur.planId);if(p.months!==1||R()<0.45)return;const st=wpick([['Active',80],['Paused',8],['Failed',12]]);mandates.push({id:'MD-'+(++mSeq),memberId:m.id,vpa:m.name.split(' ')[0].toLowerCase()+pick(['@okhdfcbank','@ybl','@paytm','@okicici','@oksbi']),amount:cur.price-cur.discount,planId:p.id,frequency:'Monthly',status:st,nextDebit:addDays(cur.end,1),lastResult:st==='Failed'?'Insufficient balance · retry '+ri(1,2)+' of 3':'Debited '+fd(cur.start),created:m.joined,retries:st==='Failed'?ri(1,2):0})});
 const offers=[{code:'DIWALI26',desc:'Festive offer on Quarterly and above',type:'%',value:15,validTill:'2026-11-10',uses:0,limit:100,status:'Active'},{code:'FRIEND500',desc:'Referral: ₹500 off for the new member',type:'₹',value:500,validTill:'2026-12-31',uses:17,limit:null,status:'Active'},{code:'STUDENT10',desc:'Students with valid college ID',type:'%',value:10,validTill:'2027-03-31',uses:9,limit:null,status:'Active'},{code:'MONSOON25',desc:'Monsoon 2025 promotion',type:'%',value:25,validTill:'2025-08-31',uses:41,limit:60,status:'Expired'}];
 const products=JSON.parse(JSON.stringify(PRODUCTS));
 // audit
 const audit=[];let alSeq=0;const A=(ts,user,role,action)=>audit.push({id:'AL-'+(++alSeq),ts,user,role,action,device:pick(['Chrome · Windows · 49.36.112.18','Safari · iPhone · 106.210.44.9','Chrome · Android · 157.35.80.21'])});
 const roleOf=n=>(STAFF.find(s=>s.name===n)||{role:'System'}).role;
 payments.filter(p=>diff(T,p.date)<=10).forEach(p=>A(p.ts,p.by,roleOf(p.by),'Recorded payment '+p.id+' of '+inr(p.amount)+' ('+p.method+') against '+p.invoice));
 invoices.filter(v=>diff(T,v.date)<=10).forEach(v=>A(v.date+' '+pad(ri(7,20))+':'+pad(ri(0,59)),v.by,roleOf(v.by),'Generated invoice #'+v.no));
 members.filter(m=>diff(T,m.joined)<=10).forEach(m=>A(m.joined+' '+pad(ri(7,20))+':'+pad(ri(0,59)),'Pooja Kumari','Receptionist','Added a new member '+m.name+' ('+m.id+')'));
 expenses.filter(e=>diff(T,e.date)<=12).forEach(e=>A(e.date+' 11:'+pad(ri(0,59)),'Anand Verma','Accountant','Recorded expense '+e.id+' · '+e.category+' '+inr(e.amount)));
 A(addDays(T,-2)+' 16:12','Ritika Sinha','Admin','Edited membership plan Quarterly (female price ₹3,700 → ₹3,600)');
 A(addDays(T,-3)+' 10:40','Pooja Kumari','Receptionist','Changed phone number of '+members[5].id+' ('+members[5].name+')');
 A(addDays(T,-1)+' 02:00','System','Automation','Automatic backup completed (daily, encrypted)');
 A(TODAY+' 07:00','System','Automation','Generated expiring-in-7-days list and payment due report');
 if(vd)A(vd.date+' 18:20','Ritika Sinha','Admin','Cancelled invoice #'+vd.no+' · reason: '+vd.voidReason);
 audit.sort((a,b)=>a.ts<b.ts?1:-1);
 const notifs=[];let nSeq=0;const N=(type,text,ts,link)=>notifs.push({id:'NT-'+(++nSeq),type,text,ts,read:false,link:link||null});
 const failedWA=wa.filter(w=>w.status==='Failed').slice(-2);failedWA.forEach(w=>N('WhatsApp failed','Message to '+w.to+' failed: number is not a valid WhatsApp number.',w.date+' '+w.time,{view:'profile',id:w.memberId}));
 N('Unusual expense','Equipment Purchase of ₹64,000 is 4× your monthly average for that category.',addDays(T,-1)+' 09:00',{view:'expenses'});
 N('High outstanding','Receivables crossed ₹20,000. Fitron AI has a collection list ready.',TODAY+' 07:00',{view:'receivables'});
 N('Low stock','BCAA 300 g and Lifting straps are below reorder level.',TODAY+' 07:05',{view:'pos'});
 N('Autopay failed',mandates.filter(x=>x.status==='Failed').length+' UPI autopay debits failed. Retries are scheduled.',TODAY+' 06:30',{view:'autopay'});
 N('Low renewal activity','Renewals are running below last month’s pace.',addDays(T,-1)+' 07:00',{view:'renewals'});
 notifs.sort((a,b)=>a.ts<b.ts?1:-1);notifs.forEach((n,i)=>{if(i>5)n.read=true});
 const lockMonths=monthsBack(13).slice(0,-2);
 const settings={gym:{name:'Power Haus Gym',tagline:'Built Stronger',address:'C-7, Sector 4, City Centre, Bokaro',state:'Jharkhand',phone:'7319742490',email:'hello@powerhausgym.in',website:'powerhausgym.in',instagram:'@powerhausbokaro',gstin:''},
  billing:{prefix:'INV-',gstEnabled:false,gstRate:18,gstType:'CGST + SGST',sac:'999723',gstin:''},
  reminders:{days:[7,3,1,0],window:3,dueEvery:5,defaultMonths:1,grace:3,birthday:true},
  wa:{provider:'Meta WhatsApp Business Cloud API',phoneId:'108955213321004',number:'+91 73197 42490',wabaId:'2211904455',token:'••••••••••••'},
  autopay:{provider:'Razorpay UPI Autopay',retries:3,retryGap:2,notify:true},
  ai:{enabled:true,dailyBrief:true,autoWinback:false},
  openingBalance:150000,ptCommission:40};
 return {v:2,plans,members,memberships,invoices,payments,expenses,docs,wa,attendance,audit,notifs,templates:JSON.parse(JSON.stringify(TEMPLATES)),settings,locks:lockMonths,leads,classes,bookings,products,workouts:JSON.parse(JSON.stringify(WORKOUTS)),diets:JSON.parse(JSON.stringify(DIETS)),progress,prs,mandates,offers,
  seq:{member:1000+members.length,ms:msSeq,inv:1000+invoices.length,pay:5000+payments.length,exp:300+eSeq,doc:dSeq,wa:wSeq,audit:alSeq,notif:nSeq,att:aSeq,lead:200+leads.length,bk:bSeq,md:mSeq,plan:10}};
}

function derive(s){
 const br=s.branch,inB=x=>br==='ALL'||x.branch===br;
 const planMap={};s.plans.forEach(p=>planMap[p.id]=p);
 const memMap={};s.members.forEach(m=>memMap[m.id]=m);
 const paid={};s.payments.forEach(p=>{if(p.status==='Success')paid[p.invoice]=(paid[p.invoice]||0)+p.amount});
 const invoices=s.invoices.filter(inB).map(i=>{let sub=0,disc=0,tax=0;i.lines.forEach(l=>{const g=l.qty*l.rate;sub+=g;disc+=+l.disc||0;tax+=(g-(+l.disc||0))*(+l.tax||0)/100});tax=Math.round(tax);const total=sub-disc+tax,pd=paid[i.no]||0,bal=i.cancelled?0:Math.max(0,total-pd);const status=i.cancelled?'CANCELLED':bal<=0?'PAID':pd>0?'PARTIALLY PAID':'UNPAID';const od=bal>0?diff(TODAY,i.due):0;return {...i,sub,disc,tax,total,paid:pd,bal,status,overdue:Math.max(0,od),m:memMap[i.memberId]}});
 const invMap={};invoices.forEach(i=>invMap[i.no]=i);
 const lines=[];invoices.forEach(i=>{if(i.cancelled)return;i.lines.forEach(l=>lines.push({date:i.date,cat:l.cat,net:l.qty*l.rate-(+l.disc||0),plan:l.plan,sku:l.sku,qty:l.qty,by:i.by,branch:i.branch,memberId:i.memberId,trainerId:i.trainerId}))});
 const msBy={};s.memberships.forEach(x=>{(msBy[x.memberId]=msBy[x.memberId]||[]).push(x)});
 const outBy={};invoices.forEach(i=>{if(i.bal>0)outBy[i.memberId]=(outBy[i.memberId]||0)+i.bal});
 const attBy={};s.attendance.forEach(a=>{if(a.memberId)(attBy[a.memberId]=attBy[a.memberId]||[]).push(a)});
 const d30=addDays(TODAY,-30),d60=addDays(TODAY,-60);
 const members=s.members.filter(m=>!m.deleted&&inB(m)).map(m=>{
  const ms=(msBy[m.id]||[]).filter(x=>!x.cancelled).sort((a,b)=>a.start<b.start?-1:1);
  const cur=ms.find(x=>x.start<=TODAY&&x.end>=TODAY)||ms[ms.length-1];
  const end=ms.length?ms.reduce((a,x)=>x.end>a?x.end:a,ms[0].end):null;
  const daysLeft=end?diff(end,TODAY):-999,out=outBy[m.id]||0;
  const status=m.suspended?'SUSPENDED':daysLeft<0?'EXPIRED':daysLeft<=7?'EXPIRING SOON':out>0?'PAYMENT PENDING':'ACTIVE';
  const plan=cur?planMap[cur.planId]:null;const att=attBy[m.id]||[];
  const last=att.reduce((a,x)=>x.date>a?x.date:a,'');const v30=att.filter(a=>a.date>=d30).length,vPrev=att.filter(a=>a.date>=d60&&a.date<d30).length;
  let risk=0;const why=[];
  if(daysLeft>=0&&!m.suspended){const since=last?diff(TODAY,last):diff(TODAY,m.joined);
   if(since>=21){risk+=55;why.push('No visit in '+since+' days')}else if(since>=10){risk+=38;why.push('Last visit '+since+' days ago')}
   if(vPrev>=6&&v30<vPrev*0.5){risk+=22;why.push('Visits down '+Math.round((1-v30/vPrev)*100)+'% vs previous month')}
   if(daysLeft<=15){risk+=15;why.push('Expires in '+daysLeft+' days')}
   if(out>0){risk+=12;why.push(inr(out)+' unpaid')}}
  const riskLevel=risk>=60?'High risk':risk>=40?'Medium risk':'';
  return {...m,ms,cur,plan,planName:plan?plan.name:'—',end,daysLeft,out,status,tag:tag(status),curFinal:cur?cur.price-(cur.discount||0):0,curPlanMonths:plan?plan.months:1,lastVisit:last,v30,vPrev,risk,riskWhy:why,riskLevel};
 });
 const payments=s.payments.filter(inB).map(p=>({...p,m:memMap[p.memberId]}));
 const expenses=s.expenses.filter(inB);
 const memberships=s.memberships.filter(x=>{const m=memMap[x.memberId];return m&&inB(m)});
 const attendance=s.attendance.filter(inB);
 const assets=(s.assets||[]).filter(inB);
 const purchases=(s.purchases||[]).filter(inB).map(p=>({...p,paid:sum(p.pays||[],x=>x.amount),bal:p.total-sum(p.pays||[],x=>x.amount)}));
 return {members,memMap,invoices,invMap,lines,payments,expenses,memberships,planMap,attendance,leads:(s.leads||[]).filter(inB),classes:(s.classes||[]).filter(inB),assets,purchases};
}

function range(p,from,to){
 const t=parse(TODAY),y=t.getFullYear(),mo=t.getMonth();
 switch(p){case 'today':return [TODAY,TODAY,'today'];case 'week':return [weekStart(TODAY),TODAY,'this week'];case 'last':return [iso(new Date(y,mo-1,1)),iso(new Date(y,mo,0)),fym(iso(new Date(y,mo-1,1)))];
  case 'quarter':return [iso(new Date(y,Math.floor(mo/3)*3,1)),TODAY,'this quarter'];case 'year':{const fy=mo>=3?y:y-1;return [iso(new Date(fy,3,1)),TODAY,'FY '+fy+'–'+String(fy+1).slice(2)]}
  case 'custom':return [from||TODAY,to||TODAY,fds(from||TODAY)+' – '+fds(to||TODAY)];default:return [iso(new Date(y,mo,1)),TODAY,fym(TODAY)]}
}
function quote(s,planId,cat,discount,includeReg,offer){
 const p=s.plans.find(x=>x.id===planId);if(!p)return null;
 const price=(cat&&p.variants&&p.variants[cat])?p.variants[cat]:p.price;const reg=includeReg?(p.regFee||0):0;
 let disc=Math.max(0,+discount||0);let offerDisc=0;if(offer){offerDisc=offer.type==='%'?Math.round(price*offer.value/100):offer.value;disc+=offerDisc}
 disc=Math.min(disc,price+reg);
 const rate=s.settings.billing.gstEnabled&&p.gst?+s.settings.billing.gstRate||0:0;const tax=Math.round((price+reg-disc)*rate/100);
 return {plan:p,price,reg,disc,offerDisc,rate,tax,total:price+reg-disc+tax};
}
const fill=(body,v)=>String(body).replace(/\{\{\s*(\w+)\s*\}\}/g,(m,k)=>v[k]!==undefined&&v[k]!==null?v[k]:m);
function memberVars(s,D,mid,extra){
 const m=D.members.find(x=>x.id===mid)||s.members.find(x=>x.id===mid)||{};const dm=D.members.find(x=>x.id===mid)||{};
 const lastInv=D.invoices.filter(i=>i.memberId===mid&&!i.cancelled).slice(-1)[0];
 return Object.assign({member_name:(m.name||'').split(' ')[0],member_id:m.id,plan_name:dm.planName||'',start_date:dm.cur?fd(dm.cur.start):'',expiry_date:dm.end?fd(dm.end):'',amount:num(dm.curFinal||0),pending_amount:num(dm.out||0),invoice_number:lastInv?lastInv.no:'',gym_name:s.settings.gym.name},extra||{});
}

const REPORTS=[
 {g:'Financial',items:[['pl','Profit & loss by month'],['rev-month','Revenue by month'],['rev-daily','Daily revenue · 30 days'],['rev-plan','Revenue by plan'],['rev-method','Revenue by payment method'],['rev-staff','Collections by staff'],['rev-type','Revenue by membership type'],['recv','Receivables'],['cashflow','Cash flow'],['gst','GST summary']]},
 {g:'Expenses',items:[['exp-cat','Expense by category'],['exp-month','Monthly expenses'],['exp-vendor','Vendor expenses']]},
 {g:'Purchases',items:[['pur-month','Purchases by month'],['pur-vendor','Purchases by vendor'],['payables','Vendor payables']]},
 {g:'Fixed assets',items:[['assets','Fixed asset register'],['dep-fy','Depreciation this FY'],['dep-month','Monthly depreciation · 12 months'],['disposals','Asset disposals']]},
 {g:'Membership',items:[['m-active','Active members'],['m-expired','Expired members'],['m-new','New members'],['m-renew','Renewals'],['m-expiring','Expiring in 15 days'],['m-plan','Plan-wise members'],['m-gender','Gender-wise'],['m-age','Age groups'],['m-source','Lead source'],['m-retention','Member retention']]},
 {g:'Operations',items:[['attendance','Daily attendance'],['classes','Class utilisation'],['pt','Trainer PT commission'],['pos','Product sales'],['leads','Lead conversion'],['risk','Members at risk (AI)']]}];
function report(key,D,s){
 const C=(l,t)=>({l,t:t||'text'});const mb=monthsBack(12);const fy=range('year')[0];let cols=[],rows=[],note='';
 const revOf=f=>sum(D.lines.filter(f),l=>l.net);const expOf=f=>sum(D.expenses.filter(f),e=>e.amount);
 const grp=(arr,kf,vf)=>{const o={};arr.forEach(x=>{const k=kf(x);if(k==null)return;o[k]=o[k]||{n:0,v:0};o[k].n++;o[k].v+=vf?vf(x):0});return o};
 const age=dob=>diff(TODAY,dob)/365.25|0;
 switch(key){
  case 'pl':cols=[C('Month'),C('Revenue','inr'),C('Operating expenses','inr'),C('Depreciation','inr'),C('Net profit','inr'),C('Margin','pct')];rows=mb.map(k=>{const r=revOf(l=>ymOf(l.date)===k),e=expOf(x=>ymOf(x.date)===k&&!x.capital),d=depIn(D.assets,k+'-01',monthEnd(k));return [fym(k),r,e,d,r-e-d,r?(r-e-d)/r*100:0]});note='Accrual basis · invoiced revenue minus operating expenses and depreciation; asset purchases are capitalised';break;
  case 'pur-month':cols=[C('Month'),C('Bills','num'),C('Stock','inr'),C('Assets','inr'),C('Expenses','inr'),C('Total','inr')];rows=mb.map(k=>{const L=D.purchases.filter(p=>ymOf(p.date)===k);const t=ty=>sum(L,p=>sum(p.lines.filter(l=>l.type===ty),l=>l.amount));return [fym(k),L.length,t('Stock'),t('Asset'),t('Expense'),sum(L,p=>p.total)]});break;
  case 'pur-vendor':{cols=[C('Vendor'),C('Bills','num'),C('Amount','inr'),C('Unpaid','inr')];const g=grp(D.purchases.filter(p=>p.date>=fy),p=>p.vendor,p=>p.total);rows=Object.entries(g).map(([k,v])=>[k,v.n,v.v,sum(D.purchases.filter(p=>p.vendor===k),p=>p.bal)]);note='This financial year';break}
  case 'payables':cols=[C('Purchase'),C('Vendor'),C('Bill'),C('Date'),C('Total','inr'),C('Paid','inr'),C('Balance','inr'),C('Days','num')];rows=D.purchases.filter(p=>p.bal>0).map(p=>[p.id,p.vendor,p.bill||'—',fd(p.date),p.total,p.paid,p.bal,diff(TODAY,p.date)]);break;
  case 'assets':cols=[C('ID'),C('Asset'),C('Category'),C('Purchased'),C('Cost','inr'),C('Method'),C('Accumulated dep.','inr'),C('Net book value','inr'),C('Status')];rows=D.assets.map(a=>{const i=assetInfo(a);return [a.id,a.name+(a.qty>1?' ×'+a.qty:''),a.category,fd(a.purchaseDate),a.cost,a.method==='SLM'?'SLM '+a.life+' yrs':'WDV '+a.rate+'%',i.acc,i.nbv,a.status]});note='Written-down value as of '+fym(TODAY);break;
  case 'dep-fy':{const fyk=fyOf(ymOf(TODAY));cols=[C('Asset'),C('Category'),C('Opening WDV','inr'),C('Additions','inr'),C('Depreciation','inr'),C('Closing WDV','inr')];rows=D.assets.filter(a=>a.status==='In use'||(a.disposedOn&&fyOf(ymOf(a.disposedOn))===fyk)).map(a=>{const i=assetInfo(a);const open=i.sch.filter(r=>r.fy<fyk);const ob=open.length?open[open.length-1].nbv:0;const add=fyOf(ymOf(a.purchaseDate))===fyk?+a.cost:0;return [a.name,a.category,ob,add,i.fyDep,i.nbv]});note='FY '+fyk+'–'+String(fyk+1).slice(2)+' · Indian financial year, April to March';break}
  case 'dep-month':cols=[C('Month'),C('Depreciation','inr'),C('Assets in use','num')];rows=mb.map(k=>[fym(k),depIn(D.assets,k+'-01',monthEnd(k)),D.assets.filter(a=>ymOf(a.purchaseDate)<=k&&(!a.disposedOn||ymOf(a.disposedOn)>=k)).length]);break;
  case 'disposals':cols=[C('Asset'),C('Purchased'),C('Cost','inr'),C('Disposed'),C('Type'),C('Book value','inr'),C('Received','inr'),C('Gain / loss','inr')];rows=D.assets.filter(a=>a.disposedOn).map(a=>{const i=assetInfo(a);return [a.name,fd(a.purchaseDate),a.cost,fd(a.disposedOn),a.status,i.nbv,+a.disposedFor||0,i.gain]});break;
  case 'rev-month':cols=[C('Month'),C('New','inr'),C('Renewal','inr'),C('PT','inr'),C('Registration','inr'),C('Products','inr'),C('Total','inr')];rows=mb.map(k=>{const f=c=>revOf(l=>ymOf(l.date)===k&&l.cat===c);const a=[f('New Membership'),f('Renewal'),f('Personal Training'),f('Registration'),f('Product')+f('Other')+f('Additional Charge')];return [fym(k),...a,sum(a)]});break;
  case 'rev-daily':cols=[C('Date'),C('Invoiced','inr'),C('Collected','inr'),C('Payments','num')];for(let i=29;i>=0;i--){const d=addDays(TODAY,-i);const p=D.payments.filter(x=>x.status==='Success'&&x.date===d);rows.push([fd(d),revOf(l=>l.date===d),sum(p,x=>x.amount),p.length])}break;
  case 'rev-plan':{cols=[C('Plan'),C('Memberships sold','num'),C('Revenue','inr'),C('Share','pct')];const g=grp(D.lines.filter(l=>l.plan&&l.date>=fy),l=>l.plan,l=>l.net);const tot=sum(Object.values(g),x=>x.v);rows=Object.entries(g).map(([k,v])=>[(D.planMap[k]||{}).name||k,v.n,v.v,tot?v.v/tot*100:0]);note='This financial year';break}
  case 'rev-method':{cols=[C('Method'),C('Payments','num'),C('Amount','inr'),C('Share','pct')];const g=grp(D.payments.filter(p=>p.status==='Success'&&p.date>=fy),p=>p.method,p=>p.amount);const tot=sum(Object.values(g),x=>x.v);rows=Object.entries(g).map(([k,v])=>[k,v.n,v.v,tot?v.v/tot*100:0]);note='This financial year';break}
  case 'rev-staff':{cols=[C('Staff'),C('Payments','num'),C('Collected','inr')];const g=grp(D.payments.filter(p=>p.status==='Success'&&p.date>=fy),p=>p.by,p=>p.amount);rows=Object.entries(g).map(([k,v])=>[k,v.n,v.v]);note='This financial year';break}
  case 'rev-type':{cols=[C('Type'),C('Line items','num'),C('Revenue','inr')];const g=grp(D.lines.filter(l=>l.date>=fy),l=>l.cat,l=>l.net);rows=Object.entries(g).map(([k,v])=>[k,v.n,v.v]);note='This financial year';break}
  case 'recv':cols=[C('Member'),C('Invoice'),C('Total','inr'),C('Paid','inr'),C('Pending','inr'),C('Due'),C('Days overdue','num')];rows=D.invoices.filter(i=>i.bal>0).map(i=>[i.m?i.m.name:'—',i.no,i.total,i.paid,i.bal,fd(i.due),i.overdue]);break;
  case 'cashflow':cols=[C('Month'),C('Collections','inr'),C('Expenses','inr'),C('Net cash','inr')];rows=mb.map(k=>{const c=sum(D.payments.filter(p=>p.status==='Success'&&ymOf(p.date)===k),p=>p.amount),e=expOf(x=>ymOf(x.date)===k);return [fym(k),c,e,c-e]});break;
  case 'gst':cols=[C('Month'),C('Taxable value','inr'),C('CGST','inr'),C('SGST','inr'),C('IGST','inr'),C('Total tax','inr')];rows=mb.map(k=>{const inv=D.invoices.filter(i=>!i.cancelled&&ymOf(i.date)===k);const tv=sum(inv,i=>i.sub-i.disc),tx=sum(inv,i=>i.tax);const ig=s.settings.billing.gstType==='IGST';return [fym(k),tv,ig?0:tx/2,ig?0:tx/2,ig?tx:0,tx]});note=s.settings.billing.gstEnabled?'GST at '+s.settings.billing.gstRate+'% · '+s.settings.billing.gstType:'GST is currently disabled in Settings';break;
  case 'exp-cat':{cols=[C('Category'),C('Entries','num'),C('Amount','inr'),C('Share','pct')];const g=grp(D.expenses.filter(e=>e.date>=fy),e=>e.category,e=>e.amount);const tot=sum(Object.values(g),x=>x.v);rows=Object.entries(g).map(([k,v])=>[k,v.n,v.v,tot?v.v/tot*100:0]);note='This financial year';break}
  case 'exp-month':{const G=['Salaries','Rent','Utilities','Marketing','Maintenance','Equipment','Inventory','Operating','Other'];cols=[C('Month'),...G.map(g=>C(g,'inr')),C('Total','inr')];rows=mb.map(k=>{const a=G.map(g=>expOf(e=>ymOf(e.date)===k&&EXP_GROUP[e.category]===g));return [fym(k),...a,sum(a)]});break}
  case 'exp-vendor':{cols=[C('Vendor'),C('Bills','num'),C('Amount','inr')];const g=grp(D.expenses.filter(e=>e.date>=fy),e=>e.vendor,e=>e.amount);rows=Object.entries(g).map(([k,v])=>[k,v.n,v.v]);note='This financial year';break}
  case 'm-active':cols=[C('ID'),C('Name'),C('Phone'),C('Plan'),C('Expiry'),C('Outstanding','inr')];rows=D.members.filter(m=>m.daysLeft>=0&&!m.suspended).map(m=>[m.id,m.name,m.phone,m.planName,fd(m.end),m.out]);break;
  case 'm-expired':cols=[C('ID'),C('Name'),C('Phone'),C('Last plan'),C('Expired on'),C('Days since','num')];rows=D.members.filter(m=>m.daysLeft<0).map(m=>[m.id,m.name,m.phone,m.planName,fd(m.end),-m.daysLeft]);break;
  case 'm-new':cols=[C('ID'),C('Name'),C('Joined'),C('Plan'),C('Source')];rows=D.members.filter(m=>m.joined>=fy).map(m=>[m.id,m.name,fd(m.joined),m.ms[0]?(D.planMap[m.ms[0].planId]||{}).name:'',m.source]);note='This financial year';break;
  case 'm-renew':cols=[C('Membership'),C('Member'),C('Plan'),C('Start'),C('End'),C('Amount','inr')];rows=D.memberships.filter(x=>x.type==='Renewal'&&x.start>=fy).map(x=>[x.id,(D.memMap[x.memberId]||{}).name,(D.planMap[x.planId]||{}).name,fd(x.start),fd(x.end),x.price-x.discount]);note='This financial year';break;
  case 'm-expiring':cols=[C('ID'),C('Name'),C('Phone'),C('Plan'),C('Expiry'),C('Days left','num')];rows=D.members.filter(m=>m.daysLeft>=0&&m.daysLeft<=15).map(m=>[m.id,m.name,m.phone,m.planName,fd(m.end),m.daysLeft]);break;
  case 'm-plan':{cols=[C('Plan'),C('Active members','num'),C('Share','pct')];const act=D.members.filter(m=>m.daysLeft>=0);const g=grp(act,m=>m.planName);rows=Object.entries(g).map(([k,v])=>[k,v.n,v.n/act.length*100]);break}
  case 'm-gender':{cols=[C('Gender'),C('Members','num'),C('Active','num')];const g=grp(D.members,m=>m.gender);rows=Object.entries(g).map(([k,v])=>[k,v.n,D.members.filter(m=>m.gender===k&&m.daysLeft>=0).length]);break}
  case 'm-age':{cols=[C('Age group'),C('Members','num'),C('Share','pct')];const b=a=>a<18?'Under 18':a<25?'18–24':a<35?'25–34':a<45?'35–44':'45+';const g=grp(D.members,m=>b(age(m.dob)));rows=['Under 18','18–24','25–34','35–44','45+'].filter(k=>g[k]).map(k=>[k,g[k].n,g[k].n/D.members.length*100]);break}
  case 'm-source':{cols=[C('Lead source'),C('Members','num'),C('Share','pct')];const g=grp(D.members,m=>m.source);rows=Object.entries(g).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=>[k,v.n,v.n/D.members.length*100]);break}
  case 'm-retention':cols=[C('Month'),C('Memberships ending','num'),C('Renewed','num'),C('Retention','pct')];rows=mb.slice(0,-1).map(k=>{const end=D.memberships.filter(x=>ymOf(x.end)===k);const ren=end.filter(x=>D.memberships.some(y=>y.memberId===x.memberId&&y.start>x.end&&diff(y.start,x.end)<=20));return [fym(k),end.length,ren.length,end.length?ren.length/end.length*100:0]});note='Renewed within 20 days of expiry';break;
  case 'attendance':cols=[C('Date'),C('Check-ins','num'),C('Unique members','num'),C('Trials & guests','num')];for(let i=13;i>=0;i--){const d=addDays(TODAY,-i);const a=D.attendance.filter(x=>x.date===d);rows.push([fd(d),a.length,new Set(a.filter(x=>x.memberId).map(x=>x.memberId)).size,a.filter(x=>!x.memberId).length])}break;
  case 'classes':{cols=[C('Class'),C('Trainer'),C('Slot'),C('Capacity','num'),C('Booked','num'),C('Attended','num'),C('No-shows','num'),C('Fill rate','pct')];D.classes.forEach(c=>{const b=(s.bookings||[]).filter(x=>x.classId===c.id&&x.status!=='Waitlist');rows.push([c.name,(STAFF.find(t=>t.id===c.trainerId)||{}).name,WD[c.day]+' '+ftime(c.time),c.cap*2,b.length,b.filter(x=>x.status==='Attended').length,b.filter(x=>x.status==='No-show').length,b.length/(c.cap*2)*100])});note='Last week and this week';break}
  case 'pt':{cols=[C('Trainer'),C('PT invoices','num'),C('PT revenue','inr'),C('Commission rate','pct'),C('Commission','inr')];TRAINERS.forEach(t=>{const l=D.lines.filter(x=>x.cat==='Personal Training'&&x.trainerId===t.id&&x.date>=range('month')[0]);const rev=sum(l,x=>x.net);rows.push([t.name,l.length,rev,t.ptRate,rev*t.ptRate/100])});note='This month · rate set per trainer';break}
  case 'pos':{cols=[C('Product'),C('Units sold','num'),C('Revenue','inr'),C('Gross margin','inr'),C('In stock','num')];(s.products||[]).forEach(p=>{const l=D.lines.filter(x=>x.sku===p.id&&x.date>=fy);const u=sum(l,x=>x.qty),rv=sum(l,x=>x.net);rows.push([p.name,u,rv,rv-u*p.cost,p.stock==null?'—':p.stock])});note='This financial year';break}
  case 'leads':{cols=[C('Source'),C('Leads','num'),C('Won','num'),C('Lost','num'),C('Conversion','pct')];const g=grp(D.leads,l=>l.source);rows=Object.entries(g).map(([k,v])=>{const w=D.leads.filter(l=>l.source===k&&l.stage==='Won').length;return [k,v.n,w,D.leads.filter(l=>l.source===k&&l.stage==='Lost').length,w/v.n*100]});break}
  case 'risk':cols=[C('ID'),C('Name'),C('Phone'),C('Risk','num'),C('Why'),C('Expiry')];rows=D.members.filter(m=>m.riskLevel).sort((a,b)=>b.risk-a.risk).map(m=>[m.id,m.name,m.phone,m.risk,m.riskWhy.join('; '),fd(m.end)]);note='Scored daily from visits, expiry and dues';break;
 }
 const title=(REPORTS.flatMap(g=>g.items).find(i=>i[0]===key)||['',''])[1];
 return {title,note,cols,rows};
}
const fmtCell=(v,t)=>t==='inr'?inr(v):t==='num'?(typeof v==='number'?num(v):v):t==='pct'?(Math.round(v*10)/10)+'%':(v==null?'':String(v));
function csv(cols,rows){const esc=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};return [cols.map(c=>esc(c.l||c)).join(','),...rows.map(r=>r.map(esc).join(','))].join('\n')}
function parseCSV(text){const rows=[];let row=[],cur='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}else if(c==='"')q=true;else if(c===','){row.push(cur);cur=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cur);cur='';if(row.some(x=>x.trim()))rows.push(row);row=[]}else cur+=c}row.push(cur);if(row.some(x=>x.trim()))rows.push(row);return rows}
function download(name,text,mime){const b=new Blob([text],{type:mime||'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function xls(cols,rows){return '<html><head><meta charset="utf-8"></head><body><table border="1"><tr>'+cols.map(c=>'<th>'+(c.l||c)+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+(v==null?'':String(v).replace(/</g,'&lt;'))+'</td>').join('')+'</tr>').join('')+'</table></body></html>'}

window.FC={DAY,MON,WD,pad,iso,parse,addDays,addMonths,diff,fd,fds,fym,fyms,inr,num,ymOf,nowT,TODAY,nowTs,ftime,fts,sum,initials,monthsBack,monthEnd,weekStart,tag,NAV,ALLV,ROLES,STAFF,TRAINERS,BRANCHES,METHODS,DOC_CATS,EXP_CATS,EXP_GROUP,INC_CATS,LINE_TYPES,LEAD_STAGES,SOURCES,TAGS,PLANS,ASSET_CATS,DEP_DEFAULT,depSchedule,assetInfo,depIn,disposalsIn,fyOf,TEMPLATES,VARS,KEY:'fitron-powerhaus-v3',seed,derive,range,quote,fill,memberVars,REPORTS,report,fmtCell,csv,parseCSV,download,xls};
})();
