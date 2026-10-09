const headerSection = document.getElementById('header');
const dashboardSection = document.getElementById('dashboard');
const printsSection = document.getElementById('prints');
const filamentManagerSection = document.getElementById('filament');
const printQueueSection = document.getElementById('queue');
const dataExportSection = document.getElementById('data');
const createPrintButton = document.getElementById('add-print-button');
const cancelPrintButton = document.getElementById('cancel-print-button');
const createSpoolButton = document.getElementById('add-spool-button');
const cancelSpoolButton = document.getElementById('cancel-spool-button');
const archiveOffBox = document.getElementById('archive-off-checkbox');

const date = new Date();

let printTracker = localStorage.getItem('printTracker');
if (!printTracker) {
    let newTracker = Object({
        prints: { },
        spools: { },
        hideArchived: false,
        schemaVersion: 1
    });
    
    saveData(newTracker);
    printTracker = localStorage.getItem('printTracker');
}

try {
    var printTrackerJ = JSON.parse(printTracker);
} catch (error) {
    console.error(error);
    let newTracker = Object({
        prints: { },
        spools: { },
        hideArchived: false,
        schemaVersion: 1
    });
    saveData(newTracker);
    printTracker = localStorage.getItem('printTracker');
    var printTrackerJ = JSON.parse(printTracker);
}
printTrackerJ.prints ??= {};
printTrackerJ.spools ??= {};
printTrackerJ.hideArchived ??= 0;
printTrackerJ.schemaVersion ??= 1;
saveData(printTrackerJ);

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
    mainHeader.classList.add("headers");
    mainHeader.id = "main-header"
    mainHeader.addEventListener("click", () => {
        showTab(Sections.DASH);
    });
headerSection.appendChild(mainHeader);

const tabButtons = Object();
for (const [key, btn] of Object.entries(buttonsData)) {
    const b = document.createElement('div');
        b.innerHTML = btn['inner'];
        b.classList.add('tab-buttons');
        b.id = btn['idprefix'] + '-button';
        b.addEventListener('click', () => {
            showTab(btn['sect']);
        });
    headerSection.appendChild(b);

    tabButtons[btn['sect']] = b;
}

// PRINTS SECTION
const printPopup = document.getElementById('print-popup');

cancelPrintButton.addEventListener('click', () => {
    printPopup.style.display = 'none';
});

var rowCount = 0;

const nameInput = document.getElementById('name-tinput');
const printDateInput = document.getElementById('date-tinput');
const linkInput = document.getElementById('link-tinput');

const filamentRowTemplate = document.getElementById('filament-row-template');
const filamentRowsDiv = document.getElementById('filament-rows');

const clone = document.importNode(filamentRowTemplate.content, true);
    const spoolDropdown = clone.querySelector('select[name="spool-select"]');
    const gramCostInput = clone.querySelector('input[type="number"]');
    addSpoolsToDropdown(spoolDropdown);
    spoolDropdown.style.margin = '10px';
    spoolDropdown.style.marginRight = '5px';
    gramCostInput.style.margin = '10px';
    gramCostInput.style.marginLeft = '5px';
filamentRowsDiv.appendChild(clone);

createPrintButton.addEventListener('click', () => {   
    const resultInputRadio1TF = document.getElementById('result-rinput1').checked;
    const successInput = resultInputRadio1TF ? true : false; // True = success, false = failure

    try {
        if ( nameInput.value.trim() != '' &&
                printDateInput.checkValidity() &&
                spoolDropdown.value != '' &&
                gramCostInput.value.toString() > 0 ) {
            let uuid = crypto.randomUUID().toString();
            printTrackerJ.prints[uuid] = {
                name: nameInput.value,
                date: printDateInput.value,
                result: successInput,
                link: linkInput.value,
                usage: [{spoolId: spoolDropdown.value, grams: Number(gramCostInput.value)}]
            };

            saveData(printTrackerJ);
            printPopup.style.display = 'none';
            renderPrints();
            renderSpools();
        }
    } catch (error) {
        console.error(error);
        printPopup.style.display = 'none';
        printsCardDiv.style.display = 'none';
        const failElem = document.createElement('p');
            failElem.innerHTML = "Failed to save print.";
            failElem.classList.add('fail-text');
        printsSection.appendChild(failElem);
    }
});

const printsCardDiv = document.createElement('div');
    printsCardDiv.classList.add('card');
printsSection.appendChild(printsCardDiv);

try {
    renderPrints();
} catch (error) {
    console.error(error);
    printsCardDiv.hidden = true;
    const failElem = document.createElement('p');
        failElem.innerHTML = "Failed to load prints.";
        failElem.classList.add('fail-text');
    printsSection.appendChild(failElem);
}    

// FILAMENT SECTION
const filamentDiv = document.createElement('div');
    filamentDiv.classList.add('card');
    filamentDiv.id = 'spools';
filamentManagerSection.appendChild(filamentDiv);

const filamentAddPopup = document.getElementById('filament-add-popup');

cancelSpoolButton.addEventListener('click', () => {
    filamentAddPopup.style.display = 'none';
});

const brandInput = document.getElementById('brand-tinput');
const materialDropdown = document.getElementById('material-dropdown');
const colorInput = document.getElementById('color-tinput');
const gramsInput = document.getElementById('grams-ninput');
const priceInput = document.getElementById('price-ninput');
const dateInput = document.getElementById('date-dinput');

createSpoolButton.addEventListener('click', () => {
    try {
        if ( brandInput.value.trim() != '' && 
                dateInput.checkValidity() &&
                colorInput.value.trim() != '' &&
                gramsInput.value > 0 ) {
            let uuid = crypto.randomUUID().toString();
            printTrackerJ.spools[uuid] = {
                brand: brandInput.value,
                material: materialDropdown.value,
                color: colorInput.value,
                startGrams: gramsInput.valueAsNumber,
                price: priceInput.valueAsNumber,
                date: dateInput.value,
                archived: false
            };

            saveData(printTrackerJ);
            filamentAddPopup.style.display = 'none';
            renderSpools();
        }
    } catch (error) {
        console.error(error);
        filamentAddPopup.style.display = 'none';
        filamentDiv.style.display = 'none';
        const failElem = document.createElement('p');
            failElem.innerHTML = "Failed to save spool.";
            failElem.classList.add('fail-text');
        filamentManagerSection.appendChild(failElem);
    }
});

try {
    archiveOffBox.checked = printTrackerJ.hideArchived;
    renderSpools();
} catch (error) {
    console.error(error);
    filamentDiv.hidden = true;
    const failElem = document.createElement('p');
        failElem.innerHTML = "Failed to load spools.";
        failElem.classList.add('fail-text');
    filamentManagerSection.appendChild(failElem);
}

// Misc
archiveOffBox.addEventListener('click', () => {
    printTrackerJ.hideArchived = archiveOffBox.checked;
    saveData(printTrackerJ);
    renderSpools();
});

showTab(Sections.PRINTS);

function renderSpools() {
    filamentDiv.replaceChildren();

    const plusSpoolElem = document.createElement('button');
        plusSpoolElem.innerHTML = '+';
        plusSpoolElem.classList.add('acc-buttons');
        plusSpoolElem.addEventListener('click', () => {
            const allInputs = filamentAddPopup.querySelectorAll('input');
            allInputs.forEach(input => {
                if (input.type === 'checkbox' || input.type === 'radio') {
                    input.checked = false;
                } else {
                    input.value = '';
                }
            });

            filamentAddPopup.style.display = 'block';
        });
    filamentDiv.appendChild(plusSpoolElem);

    if (Object.keys(printTrackerJ.spools).length > 0) {
        Object.entries(printTrackerJ.spools).forEach(([key, value]) => {
            if (value.archived) {
                if (archiveOffBox.checked == false) {
                    showSpoolCard(key, value);
                }
            } else {
                showSpoolCard(key, value);
            }
        });

        if (filamentDiv.children.length <= 1) {
            const clickElem = document.createElement('p');
                clickElem.innerHTML = "All spools are archived. Uncheck 'Hide archived' to see them, or click the + to add a new spool.";
                clickElem.classList.add('warn-text');
            filamentDiv.appendChild(clickElem);
        }
    } else {
        const clickElem = document.createElement('p');
            clickElem.innerHTML = "No spools yet! Click the + to add a spool!";
            clickElem.classList.add('warn-text');
        filamentDiv.appendChild(clickElem);
    }
}

function renderPrints() {
    printsCardDiv.replaceChildren();

    const plusPrintElem = document.createElement('button');
        plusPrintElem.innerHTML = '+';
        plusPrintElem.classList.add('acc-buttons');
        plusPrintElem.addEventListener('click', () => {
            const allInputs = printPopup.querySelectorAll('input');
            allInputs.forEach(input => {
                if (input.type === 'checkbox' || input.type === 'radio') {
                    input.checked = false;
                } else {
                    input.value = '';
                }
            });

            document.getElementById('result-rinput1').checked = true;

            let availSpools = 0;
            for (const [id, spool] of Object.entries(printTrackerJ.spools)) {
                if (!spool.archived) {
                    availSpools++;
                }
            }
            if (availSpools > 0) {
                printPopup.style.display = 'block';
                addSpoolsToDropdown(spoolDropdown);
            } else {
                alert('Not enough spools of filament to print!');
            }
        });
    printsCardDiv.appendChild(plusPrintElem);

    if (Object.keys(printTrackerJ.prints).length > 0) {
        Object.entries(printTrackerJ.prints).forEach(([key, value]) => {
            showPrintCard(key, value);
        });
    } else {
        const clickElem = document.createElement('p');
            clickElem.innerHTML = "No prints yet! Click the + to start a new print!";
            clickElem.classList.add('warn-text');
        printsCardDiv.appendChild(clickElem);
    }
}

function saveData(d) {
    localStorage.setItem('printTracker', JSON.stringify(d));
}

function showPrintCard(k, v) {
    const printCard = document.createElement('div');
        printCard.classList.add('row-card');
        printCard.id = k;
    printsCardDiv.appendChild(printCard);

    const titleOfCard = document.createElement('h2');
        titleOfCard.textContent = v.name;
        titleOfCard.classList.add('headers');
        titleOfCard.classList.add('section-header');
        titleOfCard.classList.add('no-bottom-mar');

        const successBadge = document.createElement('span');
            successBadge.textContent = v.result ? "Success" : "Failure";
            successBadge.classList.add('badge');
            if (v.result) { successBadge.classList.add('badge-green-override') }
            else { successBadge.classList.add('badge-red-override') }
            successBadge.style.color = 'var(--text)';
            successBadge.style.marginLeft = '15px';
        titleOfCard.appendChild(successBadge);
    printCard.appendChild(titleOfCard);

    const dateContainer = document.createElement('div');
        dateContainer.classList.add('body-text');
        dateContainer.style.marginBottom = '15px';
        dateContainer.classList.add('no-top-mar');
        dateContainer.classList.add('secondary-text');

        const [yyyy, mm, dd] = v.date.split('-');
        const formattedDate = `${mm}/${dd}/${yyyy}`;

        const linkA = document.createElement('a');
            linkA.textContent = v.link;
            try {
                const linkURL = new URL(v.link);
                if (linkURL.protocol != 'https:' && linkURL.protocol != 'http:') {
                    throw new Error("Invalid Link: Protocol invalid");
                } else {
                    linkA.href = linkURL;
                }
            } catch (error) {
                console.warn(error);
            }
            linkA.rel = "noopener noreferrer";
            linkA.classList.add('link-text');
            linkA.target = '_blank';
            linkA.textContent = v.link;
        if (linkA.textContent != '') dateContainer.append(formattedDate, ' | ', linkA);
        else dateContainer.append(formattedDate);

        let displayFilaString = '';
        if ((v.usage ?? []).length > 0) {
            let i = 0;
            for (const entry of v.usage) {
                const spool = printTrackerJ.spools[entry.spoolId];
                if (spool) {
                    displayFilaString += spool.brand + ', ' + spool.color + ': ' + entry.grams + 'g';
                    if (i < v.usage.length - 1) { displayFilaString += ' & '; }
                } else {
                    displayFilaString += 'Deleted spool: ' + entry.grams + 'g';
                    if (i < v.usage.length - 1) { displayFilaString += ' & '; }
                }

                i++;
            }

            dateContainer.append(' | ', displayFilaString);
        }
    printCard.appendChild(dateContainer);

    const lowerButtons = document.createElement('div');
        lowerButtons.classList.add('no-top-mar');
        lowerButtons.classList.add('flex-row')
        lowerButtons.style.padding = '10px';
        lowerButtons.style.paddingLeft = '25px';
        lowerButtons.style.paddingRight = '25px';

        const deleteButton = document.createElement('button');
            deleteButton.innerHTML = 'Delete';
            deleteButton.classList.add('buttons-filled');
            deleteButton.classList.add('inline-button');
            deleteButton.classList.add('oot-button-sz');

            deleteButton.addEventListener('click', () => {
                deletePrint(k);
            });
        lowerButtons.appendChild(deleteButton);
    printCard.appendChild(lowerButtons);
}

function showSpoolCard(k, v) {
    const spoolCard = document.createElement('div');
        spoolCard.classList.add('row-card');
        spoolCard.id = k;
    filamentDiv.appendChild(spoolCard);

    let remGramsCalc = v.startGrams - getGramUsageOfSpool(k);

    const titleOfCard = document.createElement('h2');
        titleOfCard.textContent = v.brand + ', ' + v.color;
        titleOfCard.classList.add('headers');
        titleOfCard.classList.add('section-header');
        titleOfCard.classList.add('no-bottom-mar');

        const materialOfCard = document.createElement('span');
            materialOfCard.textContent = v.material.toString().toUpperCase();
            materialOfCard.classList.add('badge');
            materialOfCard.style.color = 'var(--text)';
            materialOfCard.style.marginLeft = '15px';
        titleOfCard.appendChild(materialOfCard);

        if (v.archived) {
            const archivedBadge = document.createElement('span');
                archivedBadge.innerHTML = 'Archived';
                archivedBadge.classList.add('badge');
                archivedBadge.classList.add('badge-purple-override');
                archivedBadge.style.color = 'var(--text)';
                archivedBadge.style.marginLeft = '15px';
            titleOfCard.appendChild(archivedBadge);
        }
    spoolCard.appendChild(titleOfCard);

    const remainingGrams = document.createElement('p');
        remainingGrams.textContent = '~' + remGramsCalc.toFixed(1).toString() + 'g remaining of ' + v.startGrams.toString() + 'g';
        remainingGrams.classList.add('body-text');
        remainingGrams.classList.add('no-top-mar');
        remainingGrams.classList.add('no-bottom-mar');

        const remainingGramsPerc = document.createElement('span');
            remainingGramsPerc.textContent = '(~' + Math.round((remGramsCalc / v.startGrams) * 100).toString() + '% remaining)';
            if (remGramsCalc > (v.startGrams / 2)) {
                remainingGramsPerc.classList.add('body-text');
            } else if (remGramsCalc > v.startGrams / 4) {
                remainingGramsPerc.classList.add('warn-text');
            } else {
                remainingGramsPerc.classList.add('fail-text');
            }
            remainingGramsPerc.classList.add('inline-text');
        remainingGrams.appendChild(remainingGramsPerc);

        if (remGramsCalc <= v.startGrams / 4 && !v.archived) {
            const lowWarning = document.createElement('span');
                lowWarning.textContent = 'Filament Low!';
                lowWarning.classList.add('badge');
                lowWarning.classList.add('badge-red-override');
                lowWarning.classList.add('low-mar-badge-override');
                lowWarning.style.color = 'var(--text)';
                lowWarning.style.marginLeft = '15px';
            remainingGrams.appendChild(lowWarning);
        }
    spoolCard.appendChild(remainingGrams);

    const lowerRow = document.createElement('div');
        lowerRow.classList.add('body-text');
        lowerRow.style.marginBottom = '15px';
        lowerRow.classList.add('no-top-mar');
        lowerRow.classList.add('no-bottom-mar');
        lowerRow.classList.add('secondary-text');

        const [yyyy, mm, dd] = v.date.split('-');
        const formattedDate = `${mm}/${dd}/${yyyy}`;
        const costPerGram = v.price / v.startGrams;
        const checkedPrice = v.price ? "$" + v.price.toFixed(2).toString() : 'No price';
        const checkedCPG = costPerGram ? "~$" + costPerGram.toFixed(3).toString() + '/g' : '-';
        
        lowerRow.textContent = checkedPrice
                                + ' | ' 
                                + formattedDate
                                + ' | '
                                + checkedCPG;
    spoolCard.appendChild(lowerRow);

    const lowerButtons = document.createElement('div');
        lowerButtons.classList.add('no-top-mar');
        lowerButtons.classList.add('flex-row')
        lowerButtons.style.padding = '10px';
        lowerButtons.style.paddingLeft = '25px';
        lowerButtons.style.paddingRight = '25px';

        const archiveButton = document.createElement('button');
            archiveButton.innerHTML = v.archived ? 'Unarchive' : 'Archive';
            archiveButton.classList.add('buttons-filled');
            archiveButton.classList.add('inline-button');
            archiveButton.classList.add('oot-button-sz');

            archiveButton.addEventListener('click', () => {
                archiveSpool(k);
            });
        lowerButtons.appendChild(archiveButton);

        const deleteButton = document.createElement('button');
            deleteButton.innerHTML = 'Delete';
            deleteButton.classList.add('buttons-empty');
            deleteButton.classList.add('inline-button');
            deleteButton.classList.add('oot-button-sz');

            deleteButton.addEventListener('click', () => {
                deleteSpool(k);
            });
        lowerButtons.appendChild(deleteButton);
    spoolCard.appendChild(lowerButtons);
}

function getGramUsageOfSpool(id) {
    let usageGrams = 0;

    for (const [pk, pv] of Object.entries(printTrackerJ.prints)) {
        if (pv.usage != undefined) {
            for (const [uk, uv] of Object.entries(pv.usage)) {
                if (uv.spoolId == id) {
                    usageGrams += uv.grams;
                }
            }
        } else {
            continue;
        }
    }

    return usageGrams;
}

function addSpoolsToDropdown(selElem) {
    selElem.replaceChildren();
    for (const [id, spool] of Object.entries(printTrackerJ.spools)) {
        if (!spool.archived) { 
            const remGramsCalc = spool.startGrams - getGramUsageOfSpool(id);
            const spoolName = spool.brand + ', ' + spool.color + ': ' + spool.material.toUpperCase() + ' (' + Math.round(remGramsCalc) + 'g)';
            const optionElem = document.createElement('option');
                optionElem.textContent = spoolName;
                optionElem.classList.add('option-input');
                optionElem.value = id;
            selElem.appendChild(optionElem);
        }
    }
}

function archiveSpool(id) {
    printTrackerJ.spools[id].archived = !(printTrackerJ.spools[id].archived);
    saveData(printTrackerJ);
    renderSpools();
}

function deleteSpool(id) {
    if (!spoolIsUsed(id)) {
        if (confirm('Delete this spool?: "' + printTrackerJ.spools[id].brand + ', ' + printTrackerJ.spools[id].color + '" This cannot be undone.')) {
            delete printTrackerJ.spools[id];
            saveData(printTrackerJ);
            renderSpools();
        }
    } else {
        alert('This spool is used in prints. Archive it instead.');
    }
}

function deletePrint(id) {
    if (confirm('Delete this print?: "' + printTrackerJ.prints[id].name + '" This cannot be undone.')) {
        delete printTrackerJ.prints[id];
        saveData(printTrackerJ);
        renderPrints();
        renderSpools();
    }
}

function spoolIsUsed(id) {
    for (const [pk, pv] of Object.entries(printTrackerJ.prints)) {
        if (pv.usage != undefined) {
            for (const [uk, uv] of Object.entries(pv.usage)) {
                if (uv.spoolId == id) {
                    return true;
                }
            }
        } else {
            console.error('Print has no usage: ' + pk);
            continue;
        }
    }

    return false;
}

function showTab(t) {
    dashboardSection.hidden = true;
    printsSection.hidden = true;
    filamentManagerSection.hidden = true;
    printQueueSection.hidden = true;
    dataExportSection.hidden = true;
    for (const el of Object.values(tabButtons)) {
        el.classList.remove('active');
    }

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

    tabButtons[t].classList.add('active');
}