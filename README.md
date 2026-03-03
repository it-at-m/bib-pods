# Bibliotheks-Pods: datensouveräne personalisierte Empfehlungen in Bibliotheken

## Architektur


```mermaid
architecture-beta
    group bib(database)[Bib Daten]
        service stoc(database)[Books Stock] in bib
        service event(database)[Events] in bib
        service other(database)[Other] in bib
        service index(database)[Index] in bib
    group web(internet)[Website]
        service podwidget(internet)[Widget] in web
    group pod(cloud)[Pod]
        service frontend(internet)[Frontend] in pod
        service backend(disk)[Backend] in pod

    stoc:L -- B:index
    event:L -- B:index
    other:L -- B:index
    index:L -- L:podwidget
    frontend:R -- L:podwidget
    frontend:L -- R:backend
```


## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please open an issue with the tag "enhancement", fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".
Don't forget to give the project a star! Thanks again!

1. Open an issue with the tag "enhancement"
2. Fork the Project
3. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
4. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
5. Push to the Branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request

More about this in the [CODE_OF_CONDUCT](/CODE_OF_CONDUCT.md) file.


## License

Distributed under the MIT License. See [LICENSE](LICENSE) file for more information.


## Contact

it@M - opensource@muenchen.de
[made-with-love-shield]: https://img.shields.io/badge/made%20with%20%E2%9D%A4%20by-it%40M-yellow?style=for-the-badge
[itm-opensource]: https://opensource.muenchen.de/
