Pod scanning proposes profile entries or actions using supported data already
stored in a connected Pod. Connect a Pod and click **scan pod** to review the findings.

Each scan definition describes where to look, how to recognize a supported data
format, and which predefined mapping rules to apply. A shared runner handles all
sources. Missing or unrecognized data is skipped, and a failure in one scan does
not stop the others.

Recognizing a format does not itself justify a profile entry. Each suggestion
requires matching evidence, and its explanation describes that evidence. Changed
or unknown answers can therefore produce different suggestions or none.

The preview groups findings by source. Expand a profile
suggestion to see the matched condition and the proposed entry. Explanations stay
in the preview; only selected profile entries are saved with the user's consent.
Separate action buttons use temporary scan data without adding it to the profile.
Geocoding requires an unchecked consent box to be selected before the user can
send the address to the named service. Coordinates are compared with library
locations; the chosen library can then be selected as a profile entry. The
address and coordinates are not saved in the profile.

The public Nominatim service is intended here for fictional demo addresses. Its
[usage policy](https://operations.osmfoundation.org/policies/nominatim/) excludes
personal or confidential data and limits total application traffic to one request
per second. Use a suitable provider or hosted instance for real resident addresses.

Accepted reading preferences feed the existing
[recommendation strategies](https://it-at-m.github.io/bib-pods/recommendations/).
They participate in the same matching, selection and ordering as manually added
preferences. The scan does not select books itself.

Select individual entries in the preview and confirm to add them to the profile.
Each scan offers all findings again; accepting the same entry does not duplicate it.
Closing the preview changes nothing. After saving, the profile refreshes.
Recommendation searches remain a separate, manual action. Failed scans or saves
are shown in the dialog and can be retried.
