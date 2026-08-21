from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_BREAK
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "College_Complaint_Management_System_Project_Report.docx"
FIG = ROOT / "report_figures"
FIG.mkdir(exist_ok=True)

BLUE = "2E74B5"; DARK = "1F4D78"; LIGHT = "F4F6F9"; GRAY = "666666"; BLACK = "000000"

def set_cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd'); shd.set(qn('w:fill'), fill); tcPr.append(shd)

def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc; tcPr = tc.get_or_add_tcPr(); tcMar = tcPr.first_child_found_in('w:tcMar')
    if tcMar is None: tcMar = OxmlElement('w:tcMar'); tcPr.append(tcMar)
    for m, v in [('top',top),('start',start),('bottom',bottom),('end',end)]:
        node = tcMar.find(qn('w:'+m))
        if node is None: node=OxmlElement('w:'+m); tcMar.append(node)
        node.set(qn('w:w'), str(v)); node.set(qn('w:type'),'dxa')

def set_repeat_table_header(row):
    trPr = row._tr.get_or_add_trPr(); el=OxmlElement('w:tblHeader'); el.set(qn('w:val'),'true'); trPr.append(el)

def set_table_widths(table, widths):
    table.autofit=False
    for row in table.rows:
        for i,w in enumerate(widths): row.cells[i].width=Inches(w)
    tblPr=table._tbl.tblPr; tblW=tblPr.first_child_found_in('w:tblW')
    if tblW is None: tblW=OxmlElement('w:tblW'); tblPr.append(tblW)
    tblW.set(qn('w:w'), str(int(sum(widths)*1440))); tblW.set(qn('w:type'),'dxa')
    tblInd=OxmlElement('w:tblInd'); tblInd.set(qn('w:w'),'120'); tblInd.set(qn('w:type'),'dxa'); tblPr.append(tblInd)

def font(run, size=None, bold=None, color=None, italic=None, name='Calibri'):
    run.font.name=name; run._element.get_or_add_rPr().rFonts.set(qn('w:ascii'),name); run._element.rPr.rFonts.set(qn('w:hAnsi'),name)
    if size: run.font.size=Pt(size)
    if bold is not None: run.bold=bold
    if italic is not None: run.italic=italic
    if color: run.font.color.rgb=RGBColor.from_string(color)

doc=Document(); sec=doc.sections[0]
sec.page_width=Inches(8.5); sec.page_height=Inches(11); sec.top_margin=Inches(0.85); sec.bottom_margin=Inches(0.8); sec.left_margin=Inches(1); sec.right_margin=Inches(1)
styles=doc.styles
normal=styles['Normal']; normal.font.name='Calibri'; normal.font.size=Pt(11); normal._element.rPr.rFonts.set(qn('w:ascii'),'Calibri'); normal._element.rPr.rFonts.set(qn('w:hAnsi'),'Calibri')
normal.paragraph_format.alignment=WD_ALIGN_PARAGRAPH.JUSTIFY; normal.paragraph_format.space_after=Pt(8); normal.paragraph_format.line_spacing=1.333
for nm,sz,col,bef,aft in [('Heading 1',16,BLUE,18,10),('Heading 2',13,BLUE,12,6),('Heading 3',12,DARK,8,4)]:
    s=styles[nm]; s.font.name='Calibri'; s.font.size=Pt(sz); s.font.bold=True; s.font.color.rgb=RGBColor.from_string(col); s._element.rPr.rFonts.set(qn('w:ascii'),'Calibri'); s._element.rPr.rFonts.set(qn('w:hAnsi'),'Calibri'); s.paragraph_format.space_before=Pt(bef); s.paragraph_format.space_after=Pt(aft); s.paragraph_format.keep_with_next=True
code_style=styles.add_style('Code Block',WD_STYLE_TYPE.PARAGRAPH); code_style.font.name='Consolas'; code_style.font.size=Pt(8); code_style.paragraph_format.left_indent=Inches(.2); code_style.paragraph_format.right_indent=Inches(.2); code_style.paragraph_format.space_after=Pt(8)

header=sec.header.paragraphs[0]; header.alignment=WD_ALIGN_PARAGRAPH.RIGHT; font(header.add_run('COLLEGE COMPLAINT MANAGEMENT SYSTEM  |  MINOR PROJECT REPORT'),8,color=GRAY)
footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
field=OxmlElement('w:fldSimple'); field.set(qn('w:instr'),'PAGE'); footer._p.append(field)

def para(text='', boldlead=None, align=None, italic=False):
    p=doc.add_paragraph(); p.alignment=align if align is not None else WD_ALIGN_PARAGRAPH.JUSTIFY
    if boldlead and text.startswith(boldlead):
        font(p.add_run(boldlead),bold=True); font(p.add_run(text[len(boldlead):]),italic=italic)
    else: font(p.add_run(text),italic=italic)
    return p

def bullets(items):
    for x in items:
        p=doc.add_paragraph(style='List Bullet'); p.paragraph_format.space_after=Pt(4); p.paragraph_format.line_spacing=1.208; font(p.add_run(x))

def numbered(items):
    for x in items:
        p=doc.add_paragraph(style='List Number'); p.paragraph_format.space_after=Pt(4); font(p.add_run(x))

def table(headers, rows, widths=None, font_size=9):
    t=doc.add_table(rows=1, cols=len(headers)); t.alignment=WD_TABLE_ALIGNMENT.LEFT; t.style='Table Grid'
    for i,h in enumerate(headers):
        c=t.rows[0].cells[i]; set_cell_shading(c,LIGHT); c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER; p=c.paragraphs[0]; font(p.add_run(str(h)),font_size,bold=True,color=DARK)
    set_repeat_table_header(t.rows[0])
    for row in rows:
        cells=t.add_row().cells
        for i,v in enumerate(row):
            cells[i].vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER; set_cell_margins(cells[i]); p=cells[i].paragraphs[0]; p.paragraph_format.space_after=Pt(0); p.alignment=WD_ALIGN_PARAGRAPH.LEFT; font(p.add_run(str(v)),font_size)
    if widths: set_table_widths(t,widths)
    return t

def page(): doc.add_page_break()
def h1(x): doc.add_heading(x,level=1)
def h2(x): doc.add_heading(x,level=2)
def h3(x): doc.add_heading(x,level=3)
def code(x):
    p=doc.add_paragraph(style='Code Block'); set_cell=None; font(p.add_run(x),8,name='Consolas'); return p

def diagram(name, boxes, arrows, title):
    path=FIG/name; im=Image.new('RGB',(1400,800),'white'); d=ImageDraw.Draw(im); f=ImageFont.load_default(size=22); ft=ImageFont.load_default(size=30)
    d.text((700,35),title,fill='#1F4D78',font=ft,anchor='ma')
    for label,(x,y,w,h) in boxes.items():
        d.rounded_rectangle((x,y,x+w,y+h),radius=18,fill='#F4F6F9',outline='#2E74B5',width=4); d.multiline_text((x+w/2,y+h/2),label,fill='black',font=f,anchor='mm',align='center',spacing=6)
    for a,b,label in arrows:
        x1,y1,w1,h1=boxes[a]; x2,y2,w2,h2=boxes[b]; p1=(x1+w1,y1+h1/2); p2=(x2,y2+h2/2)
        if x2 < x1: p1=(x1,y1+h1/2); p2=(x2+w2,y2+h2/2)
        d.line((p1,p2),fill='#666666',width=4); d.polygon([(p2[0],p2[1]),(p2[0]-14 if p2[0]>p1[0] else p2[0]+14,p2[1]-9),(p2[0]-14 if p2[0]>p1[0] else p2[0]+14,p2[1]+9)],fill='#666666')
        if label: d.text(((p1[0]+p2[0])/2,(p1[1]+p2[1])/2-18),label,fill='#333333',font=ImageFont.load_default(size=16),anchor='mm')
    im.save(path); return path

arch=diagram('architecture.png',{'A':(60,280,240,110),'B':(410,280,260,110),'C':(780,150,250,110),'D':(780,410,250,110),'E':(1140,280,200,110)},[('A','B','HTTPS/JSON'),('B','C','Student APIs'),('B','D','Admin APIs'),('C','E','SQL'),('D','E','SQL')],'Overall System Architecture')
dfd0=diagram('dfd0.png',{'A':(40,160,250,100),'B':(40,500,250,100),'C':(555,300,290,130),'D':(1090,300,260,130)},[('A','C','complaint/profile'),('C','A','status/update'),('B','C','review/status'),('C','B','assigned records'),('C','D','read/write'),('D','C','data')],'Data Flow Diagram - Level 0')
workflow=diagram('workflow.png',{'A':(30,330,180,95),'B':(265,330,180,95),'C':(500,330,180,95),'D':(735,330,180,95),'E':(970,330,180,95),'F':(1205,330,160,95)},[('A','B',''),('B','C',''),('C','D',''),('D','E',''),('E','F','')],'Complaint Lifecycle')

# Cover page - editorial cover pattern
para('MINOR PROJECT REPORT',align=WD_ALIGN_PARAGRAPH.CENTER).paragraph_format.space_before=Pt(90)
p=para('COLLEGE COMPLAINT\nMANAGEMENT SYSTEM',align=WD_ALIGN_PARAGRAPH.CENTER); p.runs.clear() if False else None
for r in p.runs: font(r,26,bold=True,color=DARK)
para('A Web-Based Application for Transparent Complaint Submission and Resolution',align=WD_ALIGN_PARAGRAPH.CENTER,italic=True)
para('\nSubmitted in partial fulfillment of the requirements for the award of the degree of\nBACHELOR OF TECHNOLOGY',align=WD_ALIGN_PARAGRAPH.CENTER)
table(['Project Particular','Details'],[
('Student Name','[YOUR NAME]'),('Roll Number','[YOUR ROLL NUMBER]'),('Department','[CSE / IT / OTHER]'),('Team Members','[NAMES]'),('Project Guide','[GUIDE NAME]'),('College','[COLLEGE NAME]'),('University','[UNIVERSITY NAME]'),('Academic Year','[YEAR]')],[2.0,4.5],10)
para('\n[COLLEGE LOGO / EMBLEM]',align=WD_ALIGN_PARAGRAPH.CENTER,italic=True)

page(); h1('CERTIFICATE')
para('This is to certify that the minor project report entitled “College Complaint Management System” is a bona fide record of the work carried out by [YOUR NAME], Roll Number [YOUR ROLL NUMBER], and team members [NAMES], students of the Department of [CSE / IT / OTHER], [COLLEGE NAME], under my supervision during the academic year [YEAR]. The work embodied in this report has not been submitted elsewhere for the award of any degree or diploma to the best of our knowledge.')
para('\n\nSignature of Project Guide: ____________________\nName: [GUIDE NAME]\nDesignation: [DESIGNATION]\n\nSignature of Head of Department: ____________________\nName: [HOD NAME]\n\nDate: [DATE]                              Place: [PLACE]')

page(); h1('DECLARATION')
para('I/We hereby declare that the project entitled “College Complaint Management System,” submitted to [UNIVERSITY NAME] through [COLLEGE NAME] in partial fulfillment of the requirements for the award of the Bachelor of Technology degree, is an original work carried out by me/us under the guidance of [GUIDE NAME]. All sources of information used in this report have been appropriately acknowledged. The report does not contain work submitted previously for any other degree, diploma, or academic award.')
para('\nStudent Signature(s): ____________________\nName(s): [YOUR NAME / TEAM MEMBERS]\nRoll Number(s): [ROLL NUMBER(S)]\nDate: [DATE]')

page(); h1('ACKNOWLEDGEMENT')
para('I/We express sincere gratitude to [GUIDE NAME], Project Guide, for continuous guidance, technical suggestions, and constructive review throughout the project. I/We thank the Head of the Department, [HOD NAME], and the faculty members of the Department of [CSE / IT / OTHER] for providing the academic environment and facilities required for this work. I/We are also grateful to [COLLEGE NAME] and [UNIVERSITY NAME] for the opportunity to undertake this minor project. Finally, I/We thank our family members, classmates, and all participants who provided feedback during development and testing.')

page(); h1('ABSTRACT')
para('The College Complaint Management System is a web-based application developed to provide a structured channel through which students can register complaints and monitor their progress. Conventional complaint handling commonly depends on verbal communication, paper registers, or scattered messages, which can result in incomplete records, uncertain responsibility, and limited visibility of resolution progress. The proposed system addresses these issues by maintaining complaint records in a central relational database and offering role-specific interfaces for students, departmental staff, and a complaint coordinator or super administrator.')
para('The implemented prototype uses HTML, CSS, and JavaScript for the user interface; Node.js with the Express framework for server-side processing; and PostgreSQL for persistent storage. Students can register, authenticate, update basic profiles, submit categorized complaints with an optional image, view status stages, and delete their own complaints. Approved departmental staff can view complaints routed to their assigned department and update the complaint stage and note. A super administrator can approve staff accounts, assign departments, inspect complaints, search users, and maintain account credentials. Password recovery uses a time-limited, single-use email OTP workflow.')
para('The system demonstrates how role-based access, departmental routing, database-backed tracking, and controlled status updates can improve accountability at the scale of a B.Tech minor project. Features such as feedback storage, reports, mobile applications, SMS, analytics, chatbot assistance, automated priority prediction, and college ERP integration are identified as future enhancements and are not represented as part of the current implementation.')
para('Keywords: complaint management, student grievance, web application, role-based access, Node.js, Express, PostgreSQL.')

page(); h1('TABLE OF CONTENTS')
toc=[('Front Matter','i-viii'),('1. Introduction','1'),('2. Existing System','4'),('3. Proposed System','6'),('4. Feasibility Study','9'),('5. Requirements Analysis','12'),('6. System Users and Roles','17'),('7. System Design','20'),('8. Database Design','27'),('9. Main Modules','32'),('10. Detailed Workflow','38'),('11. User Interface Description','41'),('12. Security Features','45'),('13. Implementation Details','49'),('14. Testing','55'),('15. Results and Discussion','61'),('16. Advantages','64'),('17. Limitations','66'),('18. Future Enhancements','68'),('19. Project Schedule','71'),('20. Risk Analysis','73'),('21. Conclusion','76'),('22. References','78')]
table(['Section','Indicative Page'],toc,[5.4,1.1],9)
para('Note: Page numbers are indicative and may change after inserting college-specific certificates, screenshots, or updated fields in Microsoft Word.',italic=True)

page(); h1('LIST OF FIGURES')
table(['Figure','Title'],[('Figure 7.1','Overall system architecture'),('Figure 7.2','Data Flow Diagram - Level 0'),('Figure 7.3','Data Flow Diagram - Level 1 (Mermaid specification)'),('Figure 7.4','Use-case model (Mermaid specification)'),('Figure 7.5','Activity model (Mermaid specification)'),('Figure 7.6','Sequence model (Mermaid specification)'),('Figure 7.7','Class model (Mermaid specification)'),('Figure 8.1','Entity-Relationship model (Mermaid specification)'),('Figure 10.1','Complaint lifecycle')],[1.2,5.3],9)
page(); h1('LIST OF TABLES')
table(['Table','Title'],[(f'Table {n}','Project metadata / requirements / design record') for n in range(1,13)],[1.2,5.3],9)

# Chapters
page(); h1('1. INTRODUCTION')
h2('1.1 Background'); para('Educational institutions receive complaints related to hostels, mess facilities, academics, networks, transport, libraries, and general campus services. When these complaints are received through informal conversations or unrelated messaging channels, it becomes difficult to preserve the original description, identify responsibility, and communicate progress. A centralized web application can convert each complaint into a traceable record with an identifier, category, current stage, responsible department, and update note.')
h2('1.2 Problem Statement'); para('The problem addressed by this project is the absence of a single, transparent, and role-controlled process for submitting, routing, reviewing, and tracking student complaints. Students require acknowledgement and visibility, while staff require an organized departmental queue. The institution also requires administrative control over staff access and basic oversight of complaint records.')
h2('1.3 Motivation'); para('The project is motivated by the need to reduce uncertainty in complaint follow-up and provide evidence of actions taken. It also offers a practical academic exercise in frontend design, REST-style APIs, authentication, relational database design, server-side validation, email integration, and role-based authorization.')
h2('1.4 Need for the System'); bullets(['A single source of truth for complaint records.','A unique complaint code that students can refer to during follow-up.','Department-based routing instead of manual forwarding.','Role-specific access so students and staff see only permitted records.','A visible status lifecycle with explanatory notes.','Administrative approval of staff accounts before access is granted.'])
h2('1.5 Project Objectives'); numbered(['Provide secure registration and login for students and staff.','Allow students to submit categorized complaints with subject, details, and an optional image.','Route complaints to approved staff associated with the selected category or department.','Allow authorized staff to update complaint progress and explanatory notes.','Allow students to view their own complaint history and current stage.','Provide super-administrator control for staff approval and basic account maintenance.','Store application data in a persistent relational database.'])
h2('1.6 Scope of the Project'); para('The scope is limited to a minor-project web application for one college. It covers student and staff account handling, departmental complaint routing, status tracking, optional image evidence, and administrative oversight. It does not claim production-scale high availability, multi-college tenancy, native mobile applications, predictive analytics, formal escalation service-level agreements, or direct ERP integration.')

page(); h1('2. EXISTING SYSTEM')
h2('2.1 Description'); para('In many colleges, students communicate complaints verbally, write them in a register, contact a faculty member, or send messages through general-purpose channels. The receiver may forward the issue to another person, but the student may not receive a consistent acknowledgement or progress record. Information can become fragmented across people and media.')
h2('2.2 Limitations'); table(['Limitation','Effect'],[('No centralized record','Complaints may be duplicated, lost, or difficult to audit.'),('Unclear ownership','Students may not know which department is handling the issue.'),('Weak status visibility','Repeated manual follow-up is required.'),('Inconsistent evidence','Descriptions and supporting images may not remain connected.'),('Limited access control','Sensitive complaint information may be shared too broadly.'),('Manual reporting','Trend analysis requires time-consuming compilation.')],[2.0,4.5],9)

page(); h1('3. PROPOSED SYSTEM')
h2('3.1 Description'); para('The proposed system is a browser-based complaint portal named CampusDesk in the implementation. It provides separate workflows for students, departmental staff, and a super administrator. Complaints are categorized and stored with a unique code. Departmental staff accounts require approval and a department assignment before they can log in. The server filters complaint access by authenticated user or assigned department.')
h2('3.2 Advantages'); bullets(['Centralized complaint storage and consistent identifiers.','Immediate visibility of a complaint after submission.','Departmental routing based on approved staff assignments.','Controlled status updates by authorized departmental staff.','Improved transparency through a staged progress indicator and notes.','Reduced dependence on paper registers and scattered messages.'])
h2('3.3 Main Features'); table(['Feature','Implementation status','Summary'],[('Student registration/login','Implemented','VTU-prefixed student IDs, password hashing, sessions.'),('Staff registration/approval','Implemented','TTS-prefixed IDs; pending until super-admin approval.'),('Complaint submission','Implemented','Category, title, description, optional base64 image.'),('Complaint tracking','Implemented','Four-stage lifecycle and update note.'),('Department routing','Implemented','Routing derived from complaint category and approved staff.'),('OTP password reset','Implemented','Email OTP, expiry, attempt limit, single-use token.'),('Feedback storage','Proposed','No feedback table or endpoint in current code.'),('Reports/analytics','Proposed','Dashboard summaries exist; exportable reports do not.'),('SMS/mobile/ERP/chatbot','Future','Not implemented in the prototype.')],[1.7,1.2,3.6],8)

page(); h1('4. FEASIBILITY STUDY')
for title,text in [('4.1 Technical Feasibility','The selected stack is technically feasible for a minor project. Browsers execute the HTML, CSS, and JavaScript interface; Node.js and Express expose JSON endpoints; PostgreSQL provides relational persistence; bcryptjs hashes passwords; express-session manages authenticated sessions; and Nodemailer sends OTP email. The codebase is compact enough for a student team to understand and demonstrate.'),('4.2 Economic Feasibility','Development can be completed using open-source software and ordinary student computers. The main costs are internet access, optional hosting, a managed PostgreSQL database, and an SMTP service. For local demonstration, these costs can be negligible.'),('4.3 Operational Feasibility','The interface separates student, staff, and super-administrator tasks. Users need only basic browser skills. Categories reduce the effort required to choose a destination, while visible progress stages support understandable follow-up.'),('4.4 Schedule Feasibility','A twelve-week schedule is feasible because the project has a limited number of roles, a small relational schema, and a single-page frontend. Integration and testing should receive dedicated time because authentication and role boundaries affect every module.')]: h2(title); para(text)
table(['Feasibility Area','Assessment','Key Condition'],[('Technical','Feasible','Node.js environment and PostgreSQL connection are available.'),('Economic','Feasible','Open-source stack; optional hosting expenditure.'),('Operational','Feasible','Users receive short orientation and role approval.'),('Schedule','Feasible','Scope remains limited to implemented prototype features.')],[1.4,1.1,4.0],9)

page(); h1('5. REQUIREMENTS ANALYSIS')
h2('5.1 Functional Requirements')
reqs=[('FR-01','Register a student with name, email, college ID, hostel, and password.'),('FR-02','Authenticate a student and create a session.'),('FR-03','Allow a student to update name, hostel, and optionally password.'),('FR-04','Submit a complaint with category, title, description, and optional photo.'),('FR-05','List only the authenticated student’s complaints.'),('FR-06','Allow a student to delete only their own complaint.'),('FR-07','Register staff in pending status with a requested department.'),('FR-08','Permit staff login only after approval.'),('FR-09','Show approved staff only the complaints for their assigned department.'),('FR-10','Allow staff to update valid complaint stages and notes.'),('FR-11','Allow the super administrator to approve, reassign, or remove staff.'),('FR-12','Support OTP-based password recovery by email.')]
table(['ID','Functional Requirement'],reqs,[.8,5.7],9)
h2('5.2 Non-Functional Requirements')
table(['Category','Requirement'],[('Security','Passwords shall be stored as bcrypt hashes; protected routes shall verify role sessions.'),('Usability','Forms shall provide clear labels, validation messages, and visible status indicators.'),('Performance','Normal dashboard operations should complete within a few seconds on a college network.'),('Reliability','Database operations shall preserve complaint ownership and referential integrity.'),('Maintainability','Categories and lifecycle stages shall be consistently defined across frontend and backend.'),('Portability','The application shall run in a modern browser and a supported Node.js environment.'),('Privacy','Complaint details and user information shall be visible only to authorized roles.')],[1.4,5.1],9)
h2('5.3 Hardware Requirements'); table(['Component','Minimum / Recommended'],[('Client','Dual-core processor, 4 GB RAM, modern browser, network connection.'),('Development server','Dual-core processor, 8 GB RAM, 2 GB free storage.'),('Production deployment','Capacity should be selected after measuring concurrent users and image sizes.')],[2.0,4.5],9)
h2('5.4 Software Requirements'); table(['Layer','Technology'],[('Frontend','HTML5, CSS3, browser JavaScript.'),('Backend','Node.js with Express 4.x.'),('Database','PostgreSQL accessed through the pg library.'),('Security/session','bcryptjs and express-session.'),('Email','Nodemailer with configured SMTP environment variables.'),('Development tools','Code editor, Git, terminal, modern browser developer tools.')],[2.0,4.5],9)
h2('5.5 User Requirements'); bullets(['Students require simple submission, unique identifiers, and visible progress.','Departmental staff require a filtered work queue and controlled stage updates.','The complaint coordinator requires staff approval, department assignment, and oversight.'])

page(); h1('6. SYSTEM USERS AND ROLES')
h2('6.1 Student'); para('A student creates an account using a valid VTU-prefixed college identifier, logs in, views a personal dashboard, submits complaints, checks status, maintains basic profile information, and can delete a complaint owned by that account. Student API queries are scoped by the session user identifier.')
h2('6.2 Faculty or Staff'); para('A staff member registers with a TTS-prefixed identifier and requests a department. Registration does not grant access. After super-administrator approval, the staff member can log in, view complaints whose category matches the assigned department, and update the stage and note. This role cannot approve other staff accounts.')
h2('6.3 Administrator or Complaint Coordinator'); para('The implementation contains a super-administrator role protected by a configured key. This role approves or returns staff accounts to pending status, assigns departments, reviews all complaints, searches people, maintains selected credentials, and can delete records where required. In an institutional deployment, this role should be mapped to the designated complaint coordinator and protected by stronger account-based authentication.')
table(['Role','Create complaint','View complaint','Update status','Approve staff','Maintain accounts'],[('Student','Own','Own','No','No','Own basic profile'),('Approved staff','No','Assigned department','Assigned department','No','No'),('Super administrator','No','All','Oversight only in current UI','Yes','Students and staff')],[1.3,1.0,1.2,1.1,1.0,1.3],8)

page(); h1('7. SYSTEM DESIGN')
h2('7.1 Overall System Architecture'); doc.add_picture(str(arch),width=Inches(6.5)); para('Figure 7.1 Overall system architecture',align=WD_ALIGN_PARAGRAPH.CENTER,italic=True)
para('The browser presents role-specific views and calls Express endpoints using JSON. Server middleware authenticates the active session, validates input, enforces role and department restrictions, and executes parameterized database queries. The mail component is used only for password-recovery OTP delivery.')
h2('7.2 Module Description'); table(['Module','Responsibility'],[('Presentation','Forms, dashboards, complaint cards, progress stages, and client-side interaction.'),('Authentication','Registration, login, logout, session checking, password hashing, and recovery.'),('Complaint service','Creation, listing, deletion, routing, and controlled status updates.'),('Administration','Staff approval, department assignment, complaint oversight, and user maintenance.'),('Persistence','PostgreSQL tables and asynchronous query wrapper.'),('Email','SMTP-based OTP delivery through Nodemailer.')],[1.5,5.0],9)

page(); h2('7.3 Data Flow Diagram - Level 0'); doc.add_picture(str(dfd0),width=Inches(6.5)); para('Figure 7.2 Data Flow Diagram - Level 0',align=WD_ALIGN_PARAGRAPH.CENTER,italic=True)
h2('7.4 Data Flow Diagram - Level 1'); para('At Level 1, the complaint-management process is decomposed into authentication, complaint capture, routing, staff processing, status retrieval, and administration. The following Mermaid specification can be rendered in any Mermaid-compatible editor.')
code('''flowchart LR
S[Student] --> A[1.0 Authenticate]
A --> U[(Users)]
S --> C[2.0 Capture Complaint]
C --> D[(Complaints)]
C --> R[3.0 Determine Department]
R --> F[Faculty/Staff]
F --> P[4.0 Process and Update]
P --> D
D --> T[5.0 Track Status]
T --> S
AD[Coordinator] --> M[6.0 Approve Staff]
M --> X[(Admins)]''')
h2('7.5 Use-Case Diagram Description'); para('The primary actors are Student, Faculty/Staff, and Complaint Coordinator. The student registers, logs in, maintains a profile, submits a complaint, views status, and requests a password reset. Staff register, await approval, log in, view assigned complaints, and update stages. The coordinator approves staff, assigns departments, views all complaints, and maintains user accounts.')
code('''usecaseDiagram
actor Student
actor Staff
actor Coordinator
Student --> (Register and Login)
Student --> (Submit Complaint)
Student --> (Track Own Complaint)
Staff --> (View Department Queue)
Staff --> (Update Complaint Stage)
Coordinator --> (Approve Staff)
Coordinator --> (Assign Department)
Coordinator --> (Review All Complaints)''')

page(); h2('7.6 Activity Diagram Description'); para('The main activity begins when a student authenticates. After validation, the student completes and submits the complaint form. The server validates the category and required text, generates a code, determines the department handler, and stores the record. Approved staff review the department queue, select a valid stage, enter a note, and save the update. The student subsequently sees the changed stage and note.')
code('''flowchart TD
A([Start]) --> B[Student login]
B --> C{Valid session?}
C -- No --> D[Show error]
C -- Yes --> E[Complete complaint form]
E --> F{Valid input?}
F -- No --> E
F -- Yes --> G[Generate code and save]
G --> H[Route by category]
H --> I[Staff reviews]
I --> J[Update stage and note]
J --> K[Student views status]
K --> L([End])''')
h2('7.7 Sequence Diagram Description'); para('The sequence model emphasizes that the browser never writes directly to the database. Every request passes through the Express server, which checks the session and performs a parameterized query. Status changes additionally compare the complaint category with the staff member’s assigned department.')
code('''sequenceDiagram
participant S as Student Browser
participant API as Express Server
participant DB as PostgreSQL
participant A as Staff Browser
S->>API: POST /api/complaints
API->>API: validate session and input
API->>DB: INSERT complaint
DB-->>API: stored row
API-->>S: complaint code and stage
A->>API: GET /api/admin/complaints
API->>DB: SELECT by assigned department
DB-->>API: complaint list
A->>API: PATCH stage and note
API->>DB: UPDATE authorized complaint
API-->>A: updated complaint''')
h2('7.8 Class Diagram Description'); para('The logical model contains User, Admin, Complaint, and PasswordReset entities. A user owns zero or more complaints and may have multiple password-reset records over time. An approved admin is associated with one department and processes complaints in that category; the current database does not store a direct complaint-to-admin foreign key because routing is dynamically derived from approved departmental staff.')
code('''classDiagram
class User { id; college_id; name; email; hostel; password_hash }
class Admin { id; college_id; name; email; department; status; password_hash }
class Complaint { id; complaint_code; user_id; category; title; description; stage_index; note; photo }
class PasswordReset { id; user_id; otp; attempts; otp_expires_at; reset_token }
User "1" --> "0..*" Complaint : submits
User "1" --> "0..*" PasswordReset : requests
Admin ..> Complaint : processes by department''')

page(); h1('8. DATABASE DESIGN')
h2('8.1 Database Overview'); para('PostgreSQL is used as the relational database. The application initializes four primary tables: users, admins, complaints, and password_resets. Foreign keys connect complaints and password resets to users. Unique constraints protect student and staff identifiers, while application-level validation restricts categories, departments, account status, and stage values.')
h2('8.2 Tables and Fields')
table(['Table','Important fields','Purpose'],[('users','id, college_id, name, email, hostel, password_hash, created_at','Student identity and authentication.'),('admins','id, name, email, college_id, password_hash, requested_department, department, status, created_at','Staff identity, approval, and routing department.'),('complaints','id, complaint_code, user_id, category, title, description, officer, stage_index, note, photo, created_at','Complaint content and lifecycle state.'),('password_resets','id, user_id, otp, attempts, otp_expires_at, otp_used, reset_token, token_expires_at','Short-lived password recovery state.')],[1.2,2.8,2.5],8)
h2('8.3 Primary Keys and Foreign Keys'); bullets(['Each table uses id as its primary key.','complaints.user_id references users.id with ON DELETE CASCADE.','password_resets.user_id references users.id with ON DELETE CASCADE.','complaints.complaint_code is unique and is exposed as the human-readable tracking code.','admins.college_id and admins.email are unique; users.college_id is unique.'])
h2('8.4 Entity Relationship Diagram Description')
code('''erDiagram
USERS ||--o{ COMPLAINTS : submits
USERS ||--o{ PASSWORD_RESETS : requests
USERS { bigint id PK; text college_id UK; text email; text password_hash }
ADMINS { bigint id PK; text college_id UK; text email UK; text department; text status }
COMPLAINTS { bigint id PK; text complaint_code UK; bigint user_id FK; text category; int stage_index }
PASSWORD_RESETS { bigint id PK; bigint user_id FK; text otp; bigint otp_expires_at }''')

page(); h2('8.5 Suitable SQL Table Structures')
code('''CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  college_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  hostel TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admins (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  college_id TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  requested_department TEXT,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);''')
code('''CREATE TABLE complaints (
  id BIGSERIAL PRIMARY KEY,
  complaint_code TEXT UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  officer TEXT NOT NULL,
  stage_index INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL,
  photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE password_resets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  otp_expires_at BIGINT NOT NULL,
  otp_used INTEGER NOT NULL DEFAULT 0,
  reset_token TEXT,
  token_expires_at BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);''')
para('Implementation note: The shipped initialization code also contains compatibility migrations for older databases. The SQL above presents the review-ready logical structures and should be kept synchronized with the source before deployment.')

page(); h1('9. MAIN MODULES')
mods=[('9.1 User Registration and Login','Students register with personal details, an eight-character VTU-prefixed identifier, hostel selection, email, and password. Staff use a separate TTS-prefixed identifier and remain pending until approval. Passwords are hashed before storage. Successful authentication regenerates the session.'),('9.2 Student Dashboard','The student dashboard summarizes complaint counts and displays complaint cards with codes, categories, stages, and notes. Data is loaded only for the active student session.'),('9.3 Complaint Submission','The form collects category, subject, details, and an optional image. Server-side validation checks required fields and permitted categories before insertion.'),('9.4 Complaint Categorization','Implemented categories are Hostel, Mess, Academic, Wi-Fi & Network, Transport, Library, and General. The category acts as the departmental routing key.'),('9.5 Complaint Tracking','A complaint is represented through four stages: Submitted, Routed, In Progress, and Resolved. The stage index and note are stored in the database and returned to the student.'),('9.6 Complaint Assignment','Assignment is department-based. The server finds approved staff whose department equals the complaint category. If no approved handler exists, the complaint remains routed to the respective department using a fallback description.'),('9.7 Complaint Status Updates','Authorized staff can change a complaint to a valid lifecycle stage and provide a note. The server refuses updates if the complaint category is different from the staff member’s assigned department.'),('9.8 Admin Dashboard','The staff dashboard shows the departmental complaint queue. The super-admin view provides staff approval, department assignment, complaint oversight, user search, and credential maintenance.'),('9.9 Notifications','Implemented notification behavior is limited to email delivery of password-recovery OTPs and on-screen status messages. General complaint email/SMS notifications are future work.'),('9.10 Feedback and Complaint Closure','Complaint closure is represented by the Resolved stage. A dedicated feedback form, rating field, or feedback database table is not present; therefore feedback collection is proposed rather than implemented.')]
for t,x in mods: h2(t); para(x)

page(); h1('10. DETAILED WORKFLOW')
doc.add_picture(str(workflow),width=Inches(6.5)); para('Figure 10.1 Complaint lifecycle: Login → Submit → Route → Process → Resolve → Review',align=WD_ALIGN_PARAGRAPH.CENTER,italic=True)
numbered(['The student opens the application, registers if necessary, and logs in with a college ID and password.','The server verifies the bcrypt password hash and regenerates the authenticated session.','The student opens the complaint form, selects a category, enters a subject and details, and may attach an image.','The browser sends JSON to the protected complaint endpoint.','The server validates the session, required fields, and category.','A unique CDT-prefixed complaint code is generated and checked for collision.','The server determines currently approved staff for the selected department and stores the complaint at the Submitted stage.','An approved staff member logs in and receives only complaints in the assigned department.','The staff member reviews the complaint, selects a valid stage, enters a progress note, and saves the update.','The server verifies department authorization and updates stage_index and note.','The student refreshes or reopens the dashboard and sees the updated stage and message.','When work is complete, staff select Resolved. The current implementation treats this as closure; formal student feedback is future work.'])

page(); h1('11. USER INTERFACE DESCRIPTION')
screens=[('11.1 Login Page','Provides student credentials, links to registration and password recovery, and clear responses for unknown accounts or incorrect passwords.'),('11.2 Registration Page','Collects name, email, student college ID, hostel, and password. Staff registration is presented separately and includes a requested department.'),('11.3 Student Dashboard','Displays summary cards and the authenticated student’s complaints. Each record shows the tracking code, category, subject, stage, and latest note.'),('11.4 Complaint Submission Form','Uses category selection, subject, detailed description, and optional photo input. Required fields are validated before submission.'),('11.5 Complaint Status Page','The implemented interface presents status within complaint cards/details through a four-stage progress model rather than a separate database entity.'),('11.6 Admin Dashboard','Shows complaints assigned to the approved staff member’s department. The super-admin dashboard separately manages pending and approved staff.'),('11.7 Complaint Details Page','Displays complaint description, student information for authorized staff, image evidence when present, current stage, handler, and note. Staff controls permit lifecycle updates.'),('11.8 Reports Page','A dedicated exportable reports page is not implemented. Dashboard count summaries support basic review; charts, filters, and downloadable reports are proposed enhancements.')]
for t,x in screens: h2(t); para(x); para('[INSERT SCREENSHOT: '+t.split(' ',1)[1]+']',align=WD_ALIGN_PARAGRAPH.CENTER,italic=True)

page(); h1('12. SECURITY FEATURES')
security=[('12.1 Authentication','Student and staff credentials are checked on the server. Sessions are regenerated after successful login to reduce session fixation risk.'),('12.2 Authorization','Middleware protects complaint and administration endpoints. Student records are filtered by session user ID; staff records are filtered by department; super-administrator routes require a separate privileged session.'),('12.3 Password Protection','bcryptjs hashes passwords with a cost factor of 10. OTP values are also stored as bcrypt hashes. Password reset tokens and OTPs expire after ten minutes.'),('12.4 Input Validation','The server validates mandatory values, email format, permitted college-ID prefixes, hostel values, complaint categories, departments, account status, and stage values.'),('12.5 SQL Injection Prevention','Database calls use parameter placeholders and supplied values rather than concatenating untrusted input into SQL statements.'),('12.6 Session Management','Cookies are HTTP-only and have an eight-hour maximum age. Logout destroys the relevant session. A production deployment should add secure cookies, same-site policy, a persistent session store, and HTTPS.'),('12.7 Data Privacy','Role-based queries limit complaint exposure. However, optional photos are stored as data URLs and the development configuration contains fallback secrets; production deployment requires environment-managed secrets, retention rules, upload restrictions, and privacy policy approval.')]
for t,x in security: h2(t); para(x)
table(['Control','Implemented','Recommended production hardening'],[('Password hashing','Yes','Increase minimum password policy and consider rate limiting.'),('Parameterized SQL','Yes','Continue code review for every new query.'),('HTTP-only session cookie','Yes','Add secure and sameSite attributes under HTTPS.'),('Session store','Memory store in prototype','Use PostgreSQL/Redis-backed store.'),('CSRF protection','Not evident','Add anti-CSRF protection for state-changing requests.'),('File scanning','Not applicable to current data-URL design','Use validated object storage and malware scanning.')],[1.6,1.3,3.6],8)

page(); h1('13. IMPLEMENTATION DETAILS')
h2('13.1 Frontend'); para('The frontend is implemented as a single HTML document styled by CSS and controlled by browser JavaScript. JavaScript switches views, calls JSON APIs through fetch, renders complaint cards and summary values, validates forms, and updates progress displays. This approach is suitable for a compact minor project because it avoids a frontend build pipeline.')
h2('13.2 Backend'); para('The backend uses Node.js and Express. Routes are grouped by student authentication, password recovery, complaints, staff authentication, staff complaint handling, and super-administrator operations. Middleware functions enforce the current role before protected route logic executes.')
h2('13.3 Database'); para('The database layer uses the pg package and an asynchronous wrapper exposing run, get, and all operations. Initialization creates required tables and executes compatibility migrations. Referential actions remove dependent complaints and reset records if a student account is deleted.')
h2('13.4 APIs'); table(['Method and endpoint','Purpose','Access'],[('POST /api/register','Create student account','Public'),('POST /api/login','Student login','Public'),('GET /api/complaints','List own complaints','Student'),('POST /api/complaints','Create complaint','Student'),('POST /api/admin/register','Request staff account','Public'),('GET /api/admin/complaints','List assigned complaints','Approved staff'),('PATCH /api/admin/complaints/:code','Update stage and note','Approved staff, matching department'),('GET /api/superadmin/admins','Review staff accounts','Super administrator'),('PATCH /api/superadmin/admins/:id','Approve/reassign staff','Super administrator')],[2.5,2.5,1.5],8)
h2('13.5 Important Algorithms')
h3('Unique Complaint Code Generation'); para('The server attempts to generate a CDT- followed by a random four-digit number, checks the database for uniqueness, and retries up to twenty times. A time-based suffix is used as a fallback. The database unique constraint remains the final integrity control.')
h3('Dynamic Department Routing'); para('When a complaint is returned, the server queries approved staff in the complaint category. Handler names and the routing note therefore reflect current staff approvals rather than only the value stored when the complaint was created.')
h3('OTP Recovery'); para('A cryptographically generated six-digit OTP is emailed, stored only as a bcrypt hash, limited to five incorrect attempts, and expires after ten minutes. Successful verification produces a random reset token with a separate ten-minute expiry. After password replacement, reset records are deleted.')
h3('Status Transition Validation'); para('The backend accepts only known stage indices. The current implementation does not enforce a strict forward-only transition, so authorized staff can select any valid stage. A production workflow may add transition rules and an immutable audit history.')

page(); h1('14. TESTING')
h2('14.1 Testing Strategy'); para('Testing combines module-level checks, API integration tests, complete role workflows, and review by representative users. Because authentication and authorization are central, negative tests are as important as successful-path tests. Test data should be isolated from real student information.')
h2('14.2 Unit Testing'); para('Unit tests should cover college-ID validation, email validation, complaint-code format, category membership, stage validation, masking of email addresses, and mapping of database rows to public response objects.')
h2('14.3 Integration Testing'); para('Integration tests should start the server against a test database and verify registration, login, sessions, complaint ownership, department filtering, staff approval, OTP expiration, and cascade behavior.')
h2('14.4 System Testing'); para('System testing exercises the application through a browser from account creation to complaint resolution, including error messages, optional image handling, dashboard updates, and session logout.')
h2('14.5 User Acceptance Testing'); para('A small set of students and faculty reviewers should confirm that category selection, complaint wording, progress stages, and dashboard terminology are understandable. Acceptance should be recorded after defects are corrected.')
h2('14.6 Test Cases')
tests=[('TC-01','Student registration','Valid VTU ID and required values','Account created; session started','[RECORD DURING TEST]','[PASS/FAIL]'),('TC-02','Student registration','Duplicate college ID','409 error; no duplicate row','[RECORD]','[ ]'),('TC-03','Login','Correct ID/password','Student dashboard opens','[RECORD]','[ ]'),('TC-04','Login','Incorrect password','401 error; no session','[RECORD]','[ ]'),('TC-05','Complaint submission','Valid category/title/details','Unique complaint created at Submitted','[RECORD]','[ ]'),('TC-06','Complaint submission','Unknown category','400 validation error','[RECORD]','[ ]'),('TC-07','Complaint privacy','Student A requests list','Only Student A records returned','[RECORD]','[ ]'),('TC-08','Staff registration','Valid staff data','Pending account created','[RECORD]','[ ]'),('TC-09','Staff login','Pending account','403 pending approval','[RECORD]','[ ]'),('TC-10','Staff approval','Valid department and approved status','Staff login permitted','[RECORD]','[ ]'),('TC-11','Department queue','Approved Hostel staff','Only Hostel complaints shown','[RECORD]','[ ]'),('TC-12','Status update','Matching department, valid stage','Stage and note updated','[RECORD]','[ ]'),('TC-13','Unauthorized update','Different department complaint','403; record unchanged','[RECORD]','[ ]'),('TC-14','OTP reset','Valid OTP within expiry','Reset token issued','[RECORD]','[ ]'),('TC-15','OTP attempts','More than five wrong codes','429; verification blocked','[RECORD]','[ ]'),('TC-16','Logout','Authenticated session','Session destroyed','[RECORD]','[ ]')]
table(['ID','Module','Input','Expected Output','Actual Output','Status'],tests,[.55,1.0,1.25,1.7,1.25,.75],7)
para('The Actual Output and Status columns are intentionally left as review placeholders because execution evidence was not supplied. They should be completed during the formal test run and signed by the team or guide.',italic=True)

page(); h1('15. RESULTS AND DISCUSSION')
h2('15.1 Achieved Results'); para('Source-code review shows a functioning architecture for student accounts, complaint submission, database persistence, department-specific staff access, stage updates, staff approval, and OTP-based password recovery. The application maintains a clear separation between student, approved staff, and super-administrator operations. Parameterized queries and password hashing provide a reasonable security baseline for a minor-project prototype.')
h2('15.2 Expected Institutional Outcome'); para('When deployed with suitable policies, the proposed system is expected to reduce manual follow-up, preserve complaint history, improve departmental ownership, and give students a consistent view of progress. Its value depends on staff adoption and timely updates; software alone cannot guarantee resolution quality.')
h2('15.3 Discussion'); para('The dynamic routing design is useful because staff reassignment affects the displayed handler without rewriting every complaint. However, the design does not preserve a complete assignment history. Similarly, the four-stage index is easy to understand but lacks timestamps for each transition. These trade-offs are acceptable for the current academic scope and identify clear directions for future work.')

page(); h1('16. ADVANTAGES')
bullets(['Simple browser access with no student-side installation.','Unique complaint codes and centralized storage.','Clear separation of student, staff, and coordinator permissions.','Department-based complaint visibility and update control.','Optional image evidence connected to the complaint record.','Time-limited OTP password recovery by email.','Open-source technology stack suitable for academic demonstration.','Compact codebase that can be explained during a minor-project viva.'])

page(); h1('17. LIMITATIONS')
bullets(['The current session store is the Express in-memory default and is not suitable for scaled production deployment.','Development fallback secrets must be replaced with strong environment configuration.','Complaint images are stored as base64 text, which can increase database size.','No complaint event/audit-history table records every assignment or status transition.','No dedicated student feedback or satisfaction-rating module is implemented.','No email/SMS notification is sent for ordinary complaint updates.','No exportable reports, advanced search, analytics, escalation deadlines, or SLA monitoring are implemented.','The staff-to-department model is simple and does not model multiple campuses or organizational hierarchies.','The current minimum reset-password length of four characters is weak for production use.','Formal accessibility, penetration, load, and privacy compliance testing has not been documented.'])

page(); h1('18. FUTURE ENHANCEMENTS')
future=[('18.1 Mobile Application Support','Provide a responsive progressive web application or native mobile client using the same authenticated APIs.'),('18.2 Email and SMS Notifications','Notify students when a complaint is acknowledged, assigned, updated, resolved, or reopened. Consent and delivery failure handling must be included.'),('18.3 Complaint Priority Detection','Introduce transparent rules or a reviewed machine-learning model to suggest priority from category and text. Human staff must retain final control to avoid unsafe automatic decisions.'),('18.4 Analytics and Reports','Add date, category, department, age, and resolution-time filters with charts and CSV/PDF exports. Metrics should be defined consistently.'),('18.5 Chatbot Support','Add a guided assistant for category selection, frequently asked questions, and complaint drafting without exposing private complaint data.'),('18.6 College ERP Integration','Synchronize verified student and staff identities through approved ERP APIs, subject to university security and privacy controls.'),('18.7 Feedback and Reopening','Store student ratings, closure confirmation, comments, and controlled reopening requests in dedicated tables.'),('18.8 Audit Trail and Escalation','Record every transition with actor and timestamp, introduce due dates, and escalate overdue complaints according to an approved institutional policy.')]
for t,x in future: h2(t); para(x)

page(); h1('19. PROJECT SCHEDULE')
schedule=[('1','Problem selection, stakeholder discussion, scope definition'),('2','Requirements collection and role definition'),('3','Wireframes, navigation, and database design'),('4','Student registration, login, and sessions'),('5','Complaint submission and persistence'),('6','Student dashboard and complaint tracking'),('7','Staff registration, approval, and departmental routing'),('8','Staff dashboard and status updates'),('9','Super-admin controls and credential maintenance'),('10','Password recovery email integration and security review'),('11','Integration, system testing, and defect correction'),('12','Screenshots, documentation, presentation, and final review')]
table(['Week','Planned Activity','Deliverable'],[(w,a,('Reviewed output for '+a.split(',')[0].lower())) for w,a in schedule],[.7,3.8,2.0],8)

page(); h1('20. RISK ANALYSIS')
risks=[('Unauthorized data access','Medium','High','Enforce role middleware, department filters, HTTPS, secure sessions, and testing.'),('Weak deployment secrets','Medium','High','Require environment variables and remove development fallbacks.'),('Database/service outage','Low-Medium','High','Backups, monitoring, retry strategy, and recovery procedure.'),('Large image payloads','Medium','Medium','Restrict type/size; use object storage and thumbnails.'),('Incorrect department selection','Medium','Medium','Provide clear category guidance and coordinator reassignment.'),('Delayed staff response','Medium','High','Add ownership, due dates, reminders, and escalation policy.'),('Email OTP delivery failure','Medium','Medium','Monitor SMTP, provide retry, and define an approved support process.'),('Privacy concern','Medium','High','Minimize data, define retention, restrict access, and obtain institutional approval.'),('Scope expansion','High','Medium','Freeze minor-project baseline and schedule enhancements separately.'),('Insufficient testing evidence','Medium','High','Run signed test cases and retain screenshots/logs before review.')]
table(['Risk','Probability','Impact','Mitigation'],risks,[1.5,1.0,.8,3.2],8)

page(); h1('21. CONCLUSION')
para('The College Complaint Management System demonstrates a practical, role-based approach to campus complaint handling. The implemented prototype allows students to create accounts, submit categorized complaints, and observe progress; approved departmental staff can process only relevant records; and a super administrator can approve staff and provide oversight. Node.js, Express, PostgreSQL, browser JavaScript, session authentication, bcrypt password hashing, and email OTP recovery form a coherent full-stack solution appropriate for a B.Tech minor project.')
para('The project meets its central objective of providing an online platform for submission, tracking, and controlled management of complaints. Its current limitations—particularly the absence of feedback storage, audit history, production session storage, general notifications, and reports—are explicitly recognized. With institutional policies, security hardening, structured testing, and the proposed enhancements, the system can evolve into a more complete campus grievance-management solution.')

page(); h1('22. REFERENCES')
refs=['Node.js Documentation. https://nodejs.org/docs/latest/api/','Express.js Documentation. https://expressjs.com/','PostgreSQL Documentation. https://www.postgresql.org/docs/','node-postgres Documentation. https://node-postgres.com/','Nodemailer Documentation. https://nodemailer.com/','bcryptjs package documentation. https://www.npmjs.com/package/bcryptjs','express-session package documentation. https://www.npmjs.com/package/express-session','OWASP Foundation. OWASP Top 10 Web Application Security Risks. https://owasp.org/www-project-top-ten/','Project source code: server.js, db/database.js, lib/mailer.js, public/structure.html, public/Script.js, and public/styles.css. Accessed [DATE].']
numbered(refs)

page(); h1('APPENDIX A: REVIEW COMPLETION CHECKLIST')
table(['Item','Status / Value'],[('Replace all personal and institutional placeholders','[ ]'),('Insert college logo and mandated title-page wording','[ ]'),('Insert actual application screenshots','[ ]'),('Run and record every test case','[ ]'),('Confirm technology versions used in final deployment','[ ]'),('Update table of contents and page numbers in Word','[ ]'),('Review references in required citation style','[ ]'),('Obtain student, guide, and HOD signatures','[ ]')],[4.8,1.7],9)
para('End of report.',align=WD_ALIGN_PARAGRAPH.CENTER,italic=True)

# core metadata and save
doc.core_properties.title='College Complaint Management System - Minor Project Report'
doc.core_properties.subject='B.Tech minor project documentation'
doc.core_properties.author='[YOUR NAME]'
doc.core_properties.keywords='complaint management, Node.js, Express, PostgreSQL, B.Tech'
doc.save(OUT)
print(OUT)
