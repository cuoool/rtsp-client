const _ = require('lodash');
const consts = require('../consts');
const HttpZError = require('../error');
const utils = require('../utils');

class HttpZBaseParser {
  constructor(plainMessage, eol) {
    this.plainMessage = plainMessage;
    this.eol = eol;
  }

  _parseMessageForRows() {
    let eol2x = this.eol + this.eol;
    let [headers, body] = utils.splitIntoTwoParts(this.plainMessage, eol2x);
    if (_.isNil(headers) || _.isNil(body)) {
      // special case when the message doesn't contain body
      let regexp = new RegExp(this.eol + '+$', 'g');
      if (regexp.test(this.plainMessage)) {
        headers = this.plainMessage.replace(regexp, '');
        body = undefined;
      } else {
        throw HttpZError.get(
          'Incorrect message format, it must have headers and body, separated by empty line'
        );
      }
    }

    let headerRows = _.split(headers, this.eol);
    let startRow = headerRows[0];
    headerRows = headerRows.splice(1);
    let bodyRows = body;

    this._calcSizes(headerRows, bodyRows);

    return {
      startRow,
      headerRows,
      bodyRows
    };
  }

  _parseHeaderRows() {
    this.headers = _.map(this.headerRows, hRow => {
      let [name, values] = utils.splitIntoTwoParts(hRow, ':');
      if (!name) {
        throw HttpZError.get('Incorrect header row format, expected: Name: Values', hRow);
      }

      let valuesWithParams;
      if (_.isNil(values) || values === '') {
        valuesWithParams = [];
      } else { 
        valuesWithParams = [{
          value: values
        }];
      }

      return {
        name: utils.getHeaderName(name),
        values: valuesWithParams
      };
    });
  }

  _parseBodyRows() {
    if (!this.bodyRows) {
      return;
    }

    this.body = {};
    let contentType = _.get(this._getContentType(), 'value');
    if (contentType) {
      this.body.contentType = contentType;
    }

    switch (this.body.contentType) {
      case consts.http.contentTypes.multipart.formData:
        this._parseFormDataBody();
        break;
      case consts.http.contentTypes.application.xWwwFormUrlencoded:
        this._parseXwwwFormUrlencodedBody();
        break;
      case consts.http.contentTypes.application.json:
        this._parseJsonBody();
        break;
      default:
        this._parsePlainBody();
        break;
    }
  }

  _parseFormDataBody() {
    this.body.boundary = utils.getBoundary(this._getContentType());

    this.body.params = _.chain(this.bodyRows)
      .split(`--${this.body.boundary}`)
      .filter((unused, index, params) => index > 0 && index < params.length - 1)
      .map(param => {
        let paramMatch = param.match(consts.regexps.param);
        if (!paramMatch) {
          throw HttpZError.get('Incorrect form-data parameter', param);
        }

        let paramNameMatch = paramMatch.toString().match(consts.regexps.paramName);
        // eslint-disable-next-line no-unused-vars
        let [unused, paramName] = utils.splitIntoTwoParts(paramNameMatch.toString(), '=');

        return {
          name: paramName.replace(consts.regexps.quote, ''),
          value: param.replace(paramMatch, '').trim(this.eol)
        };
      })
      .value();
  }

  _parseXwwwFormUrlencodedBody() {
    this.body.params = _.chain(this.bodyRows)
      .split('&')
      .map(pair => {
        let [name, value] = utils.splitIntoTwoParts(pair, '=');
        if (!name) {
          throw HttpZError.get('Incorrect x-www-form-urlencoded parameter, expected: Name="Value', pair);
        }
        return { name, value };
      })
      .value();
  }

  _parseJsonBody() {
    let json = _.attempt(JSON.parse.bind(null, this.bodyRows));
    if (_.isError(json)) {
      throw HttpZError.get('Invalid json in body');
    }
    this.body.json = json;
  }

  _parsePlainBody() {
    this.body.plain = this.bodyRows;
  }

  _calcSizes(headerRows, bodyRows) {
    this.messageSize = this.plainMessage.length;
    this.headersSize = _.join(headerRows, '').length;
    this.bodySize = _.join(bodyRows, '').length;
  }

  _getContentType() {
    let contentTypeHeader = _.find(this.headers, { name: consts.http.headers.contentType });
    if (!contentTypeHeader) {
      return;
    }
    return contentTypeHeader.values[0];
  }
}

module.exports = HttpZBaseParser;
