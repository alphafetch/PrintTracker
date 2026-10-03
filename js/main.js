document.addEventListener("DOMContentLoaded", () => {
    const headerSection = document.getElementById('header');
    const dashboardSection = document.getElementById('dashboard');
    const printsSection = document.getElementById('prints');
    const filamentManagerSection = document.getElementById('filament');
    const printQueueSection = document.getElementById('queue');
    const dataExportSection = document.getElementById('data');

    const Sections = Object.freeze({
        DASH: 'dashboard',
        PRINTS: 'prints',
        FILA: 'filament',
        QUEUE: 'queue',
        DATA: 'data'
    });

    const buttonsData = Object({
        'dashboard': {
            'inner': 'Dashboard',
            'idprefix': 'dash',
            'sect': Sections.DASH
        },
        'prints': {
            'inner': 'Prints',
            'idprefix': 'prints',
            'sect': Sections.PRINTS
        },
        'filament': {
            'inner': 'Filament',
            'idprefix': 'fila',
            'sect': Sections.FILA
        },
        'queue': {
            'inner': 'Print Queue',
            'idprefix': 'queue',
            'sect': Sections.QUEUE
        },
        'data': {
            'inner': 'Data Export',
            'idprefix': 'data',
            'sect': Sections.DATA
        }
    });

    // HEADER SECTION
    const mainHeader = document.createElement('h1');
        mainHeader.innerHTML = "Print Tracker";
        mainHeader.className = "headers";
        mainHeader.id = "main-header"
        mainHeader.addEventListener("click", () => {
            showTab(Sections.DASH);
        });
    headerSection.appendChild(mainHeader);

    const tabButtons = Object();
    for (const [key, btn] of Object.entries(buttonsData)) {
        const b = document.createElement('div');
            b.innerHTML = btn['inner'];
            b.className = 'buttons';
            b.id = btn['idprefix'] + '-button';
            b.addEventListener('click', () => {
                showTab(btn['sect']);
            });
        headerSection.appendChild(b);

        tabButtons[key] = btn;
    }

    showTab(Sections.DASH);

    function showTab(t) {
        dashboardSection.hidden = true;
        printsSection.hidden = true;
        filamentManagerSection.hidden = true;
        printQueueSection.hidden = true;
        dataExportSection.hidden = true;

        switch (t) {
            case Sections.DASH:
                dashboardSection.hidden = false;
                break;
            case Sections.PRINTS:
                printsSection.hidden = false;
                break;
            case Sections.FILA:
                filamentManagerSection.hidden = false;
                break;
            case Sections.QUEUE:
                printQueueSection.hidden = false;
                break;
            case Sections.DATA:
                dataExportSection.hidden = false;
                break;
            default:
                console.error("showTab called with incorrect tabname.");
                break;
        }
    }
});