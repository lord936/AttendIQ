// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBPakjvgH-8ungDxefsJH6x7AuAo6qRFBc",
  authDomain: "attendiq-6f046.firebaseapp.com",
  projectId: "attendiq-6f046",
  storageBucket: "attendiq-6f046.firebasestorage.app",
  messagingSenderId: "1043535678423",
  appId: "1:1043535678423:web:70977ee9e7c0c95ddc1992",
  measurementId: "G-DJ9LKYSJG6"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();


let subjects = [];
let timetable = [];
let currentUser = null;

// ================= AUTH =================

function signUp() {
    let email = document.getElementById("email").value;
    let password = document.getElementById("password").value;

    auth.createUserWithEmailAndPassword(email, password)
        .then(() => alert("Account created"))
        .catch(error => alert(error.message));
}

function signIn() {
    let email = document.getElementById("email").value;
    let password = document.getElementById("password").value;

    auth.signInWithEmailAndPassword(email, password)
        .catch(error => alert(error.message));
}

function googleSignIn() {
    let provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider);
}

function logout() {
    auth.signOut();
}

auth.onAuthStateChanged(user => {

    if (user) {
        currentUser = user;
        loadCloudData();
    } else {
        currentUser = null;
        subjects = [];
        timetable = [];
        renderSubjects();
    }

});

// ================= SUBJECTS =================

function addSubject() {

    if (!currentUser) {
        alert("Please login first.");
        return;
    }

    let name = document.getElementById("subjectName").value;
    let attended = parseInt(document.getElementById("attended").value);
    let total = parseInt(document.getElementById("total").value);

    if (!name || isNaN(attended) || isNaN(total) || total === 0) {
        alert("Invalid input.");
        return;
    }

    subjects.push({ name, attended, total });
    saveCloudData();
    renderSubjects();
}

function markPresent(index) {
    subjects[index].attended++;
    subjects[index].total++;
    saveCloudData();
    renderSubjects();
}

function markAbsent(index) {
    subjects[index].total++;
    saveCloudData();
    renderSubjects();
}

function deleteSubject(index) {
    subjects.splice(index, 1);
    saveCloudData();
    renderSubjects();
}

// ================= TIMETABLE =================

function addTimetable() {

    if (!currentUser) {
        alert("Please login first.");
        return;
    }

    let subject = document.getElementById("ttSubject").value;
    let day = document.getElementById("ttDay").value;
    let startTime = document.getElementById("ttStartTime").value;
    let endTime = document.getElementById("ttEndTime").value;

    if (!subject || !day || !startTime || !endTime) {
        alert("Invalid timetable input.");
        return;
    }

    timetable.push({ subject, day, startTime, endTime });
    saveCloudData();
    alert("Timetable saved.");
}

// ================= RENDER =================

function renderSubjects() {

    let container = document.getElementById("subjectsContainer");
    container.innerHTML = "";

    if (subjects.length === 0) return;

    let totalAttended = 0;
    let totalClasses = 0;
    let minRequired = parseFloat(document.getElementById("minAttendance").value);

    subjects.forEach((sub, index) => {

        let percentage = (sub.attended / sub.total) * 100;
        totalAttended += sub.attended;
        totalClasses += sub.total;

        let status = "";
        let badge = "";

        if (percentage >= minRequired + 5) {
            status = "Safe";
            badge = "safe-badge";
        } else if (percentage >= minRequired) {
            status = "Warning";
            badge = "warning-badge";
        } else {
            status = "Critical";
            badge = "critical-badge";
        }

        container.innerHTML += `
            <div class="card">
                <h3>${sub.name}</h3>
                <p>${percentage.toFixed(1)}%</p>
                <p class="status-badge ${badge}">${status}</p>
                <button onclick="markPresent(${index})">Present</button>
                <button onclick="markAbsent(${index})">Absent</button>
                <button onclick="deleteSubject(${index})">Delete</button>
            </div>
        `;
    });

    let overall = (totalAttended / totalClasses) * 100;

    container.innerHTML =
        `
        <div class="card">
            <h2>Overall Attendance</h2>
            <p>${overall.toFixed(1)}%</p>
        </div>
        ` + container.innerHTML;
}

// ================= CLOUD =================

function saveCloudData() {

    if (!currentUser) return;

    db.collection("users").doc(currentUser.uid).set({
        subjects: subjects,
        timetable: timetable
    });
}

function loadCloudData() {

    db.collection("users").doc(currentUser.uid).get()
        .then(doc => {

            if (doc.exists) {
                subjects = doc.data().subjects || [];
                timetable = doc.data().timetable || [];
            }

            renderSubjects();
        });
}