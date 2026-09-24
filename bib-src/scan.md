Pod scanning proposes profile entries from supported data already stored in a
connected Pod. Connect a Pod and click **scan pod** to review the findings.

Each scan definition describes where to look, how to recognize a supported data
format, and which predefined mapping rules to apply. A shared runner handles all
sources. Missing or unrecognized data is skipped, and a failure in one scan does
not stop the others.

Recognizing a format does not itself justify a profile entry. Each suggestion
requires matching evidence, and its explanation describes that evidence. Changed
or unknown answers can therefore produce different suggestions or none.

The preview identifies the source and the applicable rule set. Expand a suggestion
to see the matched condition and the resulting profile suggestion side by side. These
details use a shared format and stay in the preview; they are not added to the
profile. The preview distinguishes
reported information that could be copied from recommendation themes inferred by
the rules, and explains that adopting the findings into the library profile
requires the user's consent.

The proposed additions use existing profile categories and feed the existing
recommendation strategies. Topic suggestions appear together in the normal topic
recommendations, with a book connecting multiple accepted topics first when available,
followed by a selection across the topics. Cards identify these connections using
the book's catalogue subjects. Catalogue counts
describe all matching records, not the size of the selected shelf.

Select individual entries in the preview and confirm to add them to the profile.
Each scan offers all findings again; accepting the same entry does not duplicate it.
Closing the preview changes nothing. After saving, the profile refreshes.
Recommendation searches remain a separate, manual action. Failed scans or saves
are shown in the dialog and can be retried.
