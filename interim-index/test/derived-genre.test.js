import test from "node:test"
import assert from "node:assert/strict"
import { derivedGenres } from "../derived-genre.js"

const cases = [
    // the plain convention, in the languages the stock holds
    ["Roman", ["Roman"]],
    ["roman", ["Roman"]],
    ["[Roman]", ["Roman"]],
    ["ein Roman", ["Roman"]],
    ["A Novel", ["Roman"]],
    ["romanzo", ["Roman"]],
    ["Roman nach einer wahren Geschichte", ["Roman"]],
    ["Roman ; ungekürzte Lesung", ["Roman"]],
    ["Commissario Brunettis dritter Fall : Roman", ["Roman"]],
    ["ein heiterer Roman", ["Roman"]],
    // crime and thrillers, with the regional and series formulas
    ["Kriminalroman", ["Krimi"]],
    ["ein Sylt-Krimi", ["Krimi"]],
    ["Alpenkrimi", ["Krimi"]],
    ["Oberbayern Krimi", ["Krimi"]],
    ["ein Dave Robicheaux-Krimi", ["Krimi"]],
    ["ein Fall für Poirot", ["Krimi"]],
    ["ein neuer Fall für Leopold von Herzfeldt", ["Krimi"]],
    ["Thriller", ["Thriller"]],
    ["Psychothriller : gekürzte Lesung", ["Thriller"]],
    ["was habt ihr getan? : Thriller", ["Thriller"]],
    ["ein Rizzoli-&-Isles-Thriller", ["Thriller"]],
    // historical fiction
    ["historischer Roman", ["Historischer Roman"]],
    ["Historischer Roman", ["Historischer Roman"]],
    ["historischer Kriminalroman", ["Krimi", "Historischer Roman"]],
    ["das Leben der Madame Tussaud ; historischer Roman", ["Historischer Roman"]],
    // other literary forms
    ["Erzählungen", ["Erzählungen"]],
    ["zwei Novellen", ["Erzählungen"]],
    ["Stories", ["Erzählungen"]],
    ["Gedichte", ["Lyrik"]],
    ["ausgewählte Gedichte", ["Lyrik"]],
    ["Gedichte und Erzählungen", ["Lyrik"]],
    ["a graphic novel", ["Graphic Novel"]],
    ["A Graphic Novel", ["Graphic Novel"]],
    ["ein Liebesroman", ["Liebesroman"]],
    ["Science-Fiction-Roman", ["Science-Fiction"]],
    // series novels
    ["ein Jack-Reacher-Roman", ["Roman"]],
    ["a Stephanie Plum novel", ["Roman"]],
    // children's and youth novels take the catalogue's own genre terms
    ["Kinderroman", ["Kinderbuch"]],
    ["ein Comic-Roman", ["Kinderbuch"]],
    ["ein Roman für Kinder", ["Kinderbuch"]],
    ["Jugendroman", ["Jugendbuch"]],
    // not a genre statement
    ["Roman Herzog im Gespräch", []],
    ["Leben und Werk", []],
    ["eine Biographie", []],
    ["ungekürzte Lesung", []],
    ["Hörspiel", []],
    ["das Buch zum Film", []],
    ["fantasy overture, after Shakespeare", []],
    ["= Fantasy in F minor", []],
    ["eine Einführung in den modernen Roman der Gegenwart und seine Theorie", []],
    ["Geschichte des deutschen Romans", []],
    ["", []],
    [null, []],
]

for (const [subtitle, expected] of cases) {
    test(`${JSON.stringify(subtitle)} --> ${expected.join(", ") || "none"}`, () => {
        assert.deepEqual(derivedGenres(subtitle), expected)
    })
}
